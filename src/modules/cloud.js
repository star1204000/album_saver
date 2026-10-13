/* ============================================================
 * cloud.js · 云端通道（Supabase 全家桶：元数据 + Storage 图片 + Realtime）
 * ------------------------------------------------------------
 * 设计要点：
 *   1. 只用 Supabase 一个云服务（注册即用、免绑卡）：
 *      - PostgreSQL photos 表  → 元数据
 *      - Storage photos 桶     → 照片原图（免费 1GB）
 *      - Realtime             → 多端实时推送
 *   2. supabase-js 动态 import：纯本地模式（未配置 env）完全不加载，
 *      首屏零负担；云模式按需加载（Vite 分包 vendorCloud chunk）
 *   3. 配置来自 .env.local（VITE_* 前缀）；缺任何一项 → 自动降级本地模式
 *   4. 上传走 supabase-js Storage API（内部即 REST fetch，无浏览器兼容坑，
 *      File body 直接上传；公开 URL 由 getPublicUrl 拼接）
 * ============================================================ */

const env = import.meta.env || {}
const cfg = {
  enabled: false,
  supabaseUrl: env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || '',
  storageBucket: env.VITE_STORAGE_BUCKET || 'photos',   // Storage 桶名，默认 photos
  sb: null,        // SupabaseClient（惰性）
  channel: null
}

export function isCloudEnabled() { return cfg.enabled }

/* ---------------- 初始化：探测配置 → 试连 Supabase ---------------- */
export async function initCloud() {
  if (!(cfg.supabaseUrl && cfg.supabaseAnonKey && cfg.storageBucket)) {
    return { mode: 'local', reason: '未配置云服务（.env.local），运行于纯本地模式' }
  }
  try {
    // 试连：原生 fetch 探测 + 5 秒超时（避免 supabase-js 内部长重试阻塞启动）
    const probe = await fetch(`${cfg.supabaseUrl}/rest/v1/photos?select=id&limit=1`, {
      headers: {
        apikey: cfg.supabaseAnonKey,
        Authorization: `Bearer ${cfg.supabaseAnonKey}`
      },
      signal: AbortSignal.timeout(5000)
    })
    if (!probe.ok) throw new Error(`Supabase 探测失败 HTTP ${probe.status}${probe.status === 404 ? '（photos 表未创建？请先执行 supabase_schema.sql）' : ''}`)
    const { createClient } = await import('@supabase/supabase-js')
    cfg.sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } }
    })
    cfg.enabled = true
    return { mode: 'cloud' }
  } catch (err) {
    console.warn('[cloud] 初始化失败，降级本地模式:', err)
    cfg.sb = null
    return { mode: 'local', reason: `云服务连接失败：${err.message || err}` }
  }
}

/* ---------------- 字段映射（数据库行 ↔ 前端 PhotoItem） ---------------- */

/** 数据库行 → PhotoItem（视图层只认 p.url） */
export function dbToPhotoItem(row) {
  if (!row) return null
  return {
    id: row.id,
    url: row.image_url || '',
    storagePath: row.storage_path || '',
    date: row.date || '',
    location: row.location || '',
    coords: row.coords && typeof row.coords.lat === 'number' ? row.coords : null,
    caption: row.caption || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    customTags: Array.isArray(row.custom_tags) ? row.custom_tags : [],
    sortOrder: row.sort_order ?? 0,
    stored: false,          // 云端图片不占用本地 IndexedDB
    cloud: true
  }
}

/** PhotoItem 字段补丁 → 数据库 UPDATE 载荷 */
export function patchToDb(patch = {}) {
  const db = {}
  if ('url' in patch) db.image_url = patch.url
  if ('storagePath' in patch) db.storage_path = patch.storagePath
  if ('date' in patch) db.date = patch.date
  if ('location' in patch) db.location = patch.location
  if ('coords' in patch) db.coords = patch.coords
  if ('caption' in patch) db.caption = patch.caption
  if ('tags' in patch) db.tags = patch.tags
  if ('customTags' in patch) db.custom_tags = patch.customTags
  if ('sortOrder' in patch) db.sort_order = patch.sortOrder
  return db
}

/* ---------------- 元数据 CRUD ---------------- */

export async function fetchAllPhotos() {
  const { data, error } = await cfg.sb
    .from('photos')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(dbToPhotoItem)
}

export async function insertPhotoMeta(item) {
  const row = {
    image_url: item.url,
    storage_path: item.storagePath,
    date: item.date,
    location: item.location || '',
    coords: item.coords,
    caption: item.caption || '',
    tags: item.tags || [],
    custom_tags: item.customTags || [],
    sort_order: item.sortOrder ?? 0
  }
  const { data, error } = await cfg.sb.from('photos').insert(row).select().single()
  if (error) throw new Error(error.message)
  return dbToPhotoItem(data)
}

export async function updatePhotoMeta(id, patch) {
  const { error } = await cfg.sb.from('photos').update(patchToDb(patch)).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deletePhotoMeta(id) {
  const { error } = await cfg.sb.from('photos').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** 拖拽排序：批量更新 sort_order */
export async function updateSortOrders(patches) {
  if (!patches.length) return
  const updates = await Promise.allSettled(
    patches.map(({ id, sortOrder }) =>
      cfg.sb.from('photos').update({ sort_order: sortOrder }).eq('id', id)
    )
  )
  const failed = updates.filter(r => r.status === 'rejected')
  if (failed.length) console.warn('[cloud] 部分排序更新失败', failed)
}

/* ---------------- Supabase Storage（照片原图存储） ---------------- */

/**
 * 生成 uuid v4。
 * 注意：crypto.randomUUID 仅在安全上下文可用（https 或 localhost）。
 * 手机经局域网 http://192.168.x.x 访问时为非安全上下文，randomUUID 不可用，
 * 必须降级为纯 JS 生成，否则 Storage 上传会因「无法生成对象路径」而失败。
 */
function genUuid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* 非安全上下文，走降级 */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : ((r & 0x3) | 0x8)
    return v.toString(16)
  })
}

/**
 * 生成 Storage 对象路径：{uuid}.{ext}
 * 注意：不带目录前缀——Storage API 会自动拼「桶名/路径」，
 * 若 path 再加 photos/ 前缀会得到双重目录（实测踩坑）。
 */
export function makeStoragePath(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase()
  const safeExt = /^(jpg|jpeg|png|webp|gif|heic|avif)$/.test(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg'
  return `${genUuid()}.${safeExt}`
}

/**
 * 照片直传 Supabase Storage（原图上传，多端共享）
 * 前置条件：Storage 已创建 photos 公开桶（见 README 第 2 步）
 * @param {File|Blob} file
 * @returns {Promise<{path: string, url: string}>}
 */
export async function uploadImageToStorage(file) {
  const path = makeStoragePath(file.name)
  const { error } = await cfg.sb.storage
    .from(cfg.storageBucket)
    .upload(path, file, {
      contentType: file.type || 'image/jpeg',
      cacheControl: '31536000',       // 图片不可变（uuid 命名），长缓存
      upsert: false
    })
  if (error) throw new Error(`Storage 上传失败：${error.message}`)
  const { data } = cfg.sb.storage.from(cfg.storageBucket).getPublicUrl(path)
  return { path, url: data.publicUrl }
}

/** 删除 Storage 对象（照片删除时联动清理，失败不阻塞流程） */
export async function deleteStorageObject(path) {
  if (!path) return false
  try {
    const { error } = await cfg.sb.storage.from(cfg.storageBucket).remove([path])
    if (error) throw new Error(error.message)
    return true
  } catch (err) {
    console.warn('[cloud] Storage 对象删除失败（可稍后在控制台清理）:', path, err)
    return false
  }
}

/* ---------------- Realtime 订阅（多端实时协同核心） ---------------- */

/**
 * 订阅 photos 表变更
 * @param {Object} handlers { onInsert(row), onUpdate(row), onDelete(row), onStatus(status) }
 *   - INSERT/UPDATE 的 row 为数据库新行；DELETE 的 row 含 old.id（需 replica identity full）
 *   - onStatus: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'
 * @returns 取消订阅函数
 */
export function subscribeRealtime(handlers) {
  if (!cfg.enabled || !cfg.sb) return () => {}
  if (cfg.channel) { cfg.sb.removeChannel(cfg.channel); cfg.channel = null }

  cfg.channel = cfg.sb
    .channel('photos-realtime')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'photos' },
      ({ new: row }) => handlers.onInsert?.(row))
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'photos' },
      ({ new: row }) => handlers.onUpdate?.(row))
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'photos' },
      ({ old: row }) => handlers.onDelete?.(row))
    .subscribe(status => handlers.onStatus?.(status))

  return () => {
    if (cfg.channel) { cfg.sb.removeChannel(cfg.channel); cfg.channel = null }
  }
}
