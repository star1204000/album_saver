/* ============================================================
 * state.js · 响应式数据中心 + 事件总线 + 双模式持久化
 * ------------------------------------------------------------
 * 模式：
 *   cloud（配置了 Supabase）——云端为唯一数据底座：
 *     上传 → Storage 直传原图 + Supabase INSERT → Realtime 推送所有端
 *     编辑 → 本地乐观更新 + Supabase UPDATE（回声事件自动去重）
 *   local（未配置云）——原单机版：IndexedDB Blob + localStorage
 *
 * 事件总线（模块解耦唯一通道）：
 *   photos:changed { added? removed? reordered? imported? initial? remote? }
 *   photo:updated  { id }
 *   active:changed { idx, fast }    view:changed boolean
 *   theme:changed  'light'|'dark'   toast { msg, type }
 *   cloud:status   { mode, state, reason? }   state: 'connected'|'disconnected'|'local'
 *
 * PhotoItem（两种模式统一）：
 *   { id, url, storagePath?, date, location, coords, caption, tags[],
 *     customTags[], sortOrder, stored?, remoteUrl?, demo?, cloud? }
 * ============================================================ */
import { extractMeta } from './exif.js'
import {
  isCloudEnabled, fetchAllPhotos, insertPhotoMeta, updatePhotoMeta,
  deletePhotoMeta, updateSortOrders, uploadImageToStorage, deleteStorageObject,
  subscribeRealtime
} from './cloud.js'

/* ---------------- 事件总线 ---------------- */
const listeners = new Map()
export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set())
    listeners.get(evt).add(fn)
    return () => bus.off(evt, fn)
  },
  off(evt, fn) { listeners.get(evt)?.delete(fn) },
  emit(evt, payload) {
    listeners.get(evt)?.forEach(fn => {
      try { fn(payload) } catch (err) { console.error(`[bus:${evt}]`, err) }
    })
  }
}

export function toast(msg, type = 'ok') { bus.emit('toast', { msg, type }) }

/* ---------------- 全局状态 ---------------- */
export const state = {
  photos: [],
  activeIdx: 0,
  presenting: false,
  theme: 'light',
  cloudReady: false       // initCloud 成功后置 true
}

/* ---------------- 工具 ---------------- */
const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const pad2 = n => String(n).padStart(2, '0')
const fmtDate = d => `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`
const inCloud = () => state.cloudReady && isCloudEnabled()

/* ---------------- Realtime 回声去重 ----------------
 * 本端发起的写操作先 markPending(id)，Realtime 把同一变更推回来时
 * consumePending 命中即跳过（数据已乐观应用到本地）。  */
const pendingOps = new Map()
function markPending(id) { pendingOps.set(id, Date.now()) }
function consumePending(id) {
  const ts = pendingOps.get(id)
  if (ts === undefined) return false
  pendingOps.delete(id)
  return Date.now() - ts < 8000
}

/* ---------------- IndexedDB（本地模式图片仓库） ---------------- */
const DB_NAME = 'summer-memory-album', DB_STORE = 'blobs', DB_VERSION = 1
let dbPromise = null
function idb() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idbPut(key, blob) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(blob, key)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}
async function idbGet(key) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const rq = db.transaction(DB_STORE).objectStore(DB_STORE).get(key)
    rq.onsuccess = () => resolve(rq.result)
    rq.onerror = () => reject(rq.error)
  })
}
async function idbDel(key) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).delete(key)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

/* ---------------- Object URL 生命周期（本地模式） ---------------- */
const urlMap = new Map()
function bindUrl(id, blob) {
  const old = urlMap.get(id)
  if (old) URL.revokeObjectURL(old)
  const url = URL.createObjectURL(blob)
  urlMap.set(id, url)
  return url
}
export function getUrl(id) { return urlMap.get(id) || '' }

/* ---------------- 本地模式图片压缩 ---------------- */
async function compressImage(file, maxSide = 1920, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        URL.revokeObjectURL(url)
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob 失败')), 'image/jpeg', quality)
      } catch (err) { URL.revokeObjectURL(url); reject(err) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解析失败')) }
    img.src = url
  })
}

/* ---------------- 持久化（本地模式：元数据极小，localStorage 足矣） ---------------- */
const LS_PHOTOS = 'sm-album:photos:v1'
const LS_THEME = 'sm-album:theme'
let saveTimer = null
function persist() {
  if (inCloud()) return                       // 云模式以 Supabase 为准，不写本地快照
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const data = state.photos.map(({ url, ...rest }) => rest)
      localStorage.setItem(LS_PHOTOS, JSON.stringify(data))
    } catch (err) {
      console.warn('本地保存失败', err)
      toast('本地保存失败，浏览器存储空间可能不足', 'error')
    }
  }, 400)
}

/* ============================================================
 * 启动恢复（main.js：先 await initCloud() 再调本函数）
 * ============================================================ */
export async function hydrate() {
  // 主题（本机偏好，两种模式都存本地）
  try { state.theme = localStorage.getItem(LS_THEME) || 'light' } catch { /* ignore */ }
  document.documentElement.dataset.theme = state.theme

  // —— 云模式：全量拉取 + Realtime 订阅 ——
  if (inCloud()) {
    try {
      const rows = await fetchAllPhotos()
      // 同 id 去重保险（历史竞态可能残留重复行；Map 按 id 保留最后一条）
      state.photos = [...new Map(rows.map(r => [r.id, r])).values()]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      attachRealtime()
      bus.emit('cloud:status', { mode: 'cloud', state: 'connected' })
      return true
    } catch (err) {
      console.warn('[cloud] 全量拉取失败，降级本地缓存:', err)
      bus.emit('cloud:status', { mode: 'cloud', state: 'disconnected', reason: err.message })
      // 降级读本地缓存（云模式上次会话可能没写过，等价于空）
      state.photos = readLocalCache()
      return state.photos.length > 0
    }
  }

  // —— 本地模式：localStorage 元数据 + IndexedDB Blob 重建 ——
  bus.emit('cloud:status', { mode: 'local', state: 'local' })
  const saved = readLocalCache()
  if (!saved.length) return false      // 首次访问 → main.js 填演示数据

  try { await idb() } catch (err) { console.warn('IndexedDB 不可用', err) }
  state.photos = await Promise.all(saved.map(async p => ({
    ...p,
    tags: Array.isArray(p.tags) ? p.tags : [],
    customTags: Array.isArray(p.customTags) ? p.customTags : [],
    url: p.stored
      ? await (async () => { try { const b = await idbGet(p.id); return b ? bindUrl(p.id, b) : '' } catch { return '' } })()
      : (p.remoteUrl || '')
  })))
  return true
}

function readLocalCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_PHOTOS) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch { return [] }
}

/* ---------------- Realtime：远端变更 → 本地合并 ---------------- */
let realtimeUnsub = null
function insertRemoteRow(row) {
  if (!row?.id || state.photos.some(p => p.id === row.id)) return
  const item = rowToItem(row)
  // 按 sortOrder → created_at 插入正确位置
  const i = state.photos.findIndex(p => (p.sortOrder ?? 0) > (item.sortOrder ?? 0))
  i < 0 ? state.photos.push(item) : state.photos.splice(i, 0, item)
  bus.emit('photos:changed', { remote: 'insert' })
}
function attachRealtime() {
  realtimeUnsub?.()
  realtimeUnsub = subscribeRealtime({
    onInsert(row) { insertRemoteRow(row) },
    onUpdate(row) {
      if (!row?.id) return
      if (consumePending(row.id)) return          // 自己的回声，跳过
      const p = state.photos.find(x => x.id === row.id)
      if (!p) return insertRemoteRow(row)         // 未知行：按新增处理
      Object.assign(p, rowToItem(row))
      bus.emit('photos:changed', { remote: 'update' })
    },
    onDelete(row) {
      const id = row?.id || row?.old?.id
      if (!id) return
      if (consumePending(id)) return
      const i = state.photos.findIndex(x => x.id === id)
      if (i >= 0) {
        state.photos.splice(i, 1)
        if (state.activeIdx >= state.photos.length) state.activeIdx = Math.max(0, state.photos.length - 1)
        bus.emit('photos:changed', { remote: 'delete' })
      }
    },
    onStatus(status) {
      if (status === 'SUBSCRIBED') bus.emit('cloud:status', { mode: 'cloud', state: 'connected' })
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') bus.emit('cloud:status', { mode: 'cloud', state: 'disconnected' })
    }
  })
}

function rowToItem(row) {
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
    stored: false,
    cloud: true
  }
}

/* ============================================================
 * 变更 API（云/本地自动分支，视图层无感知）
 * ============================================================ */

/**
 * 批量导入照片
 * 云模式：exifr 解析 → Storage 直传原图 → Supabase INSERT（Realtime 推送其他端）
 * 本地模式：压缩 → IndexedDB 入库
 */
export async function addPhotos(fileList) {
  const files = [...fileList].filter(f => /^image\//i.test(f.type))
  if (!files.length) { toast('请选择图片文件（JPG / PNG / WEBP）', 'warn'); return }

  if (inCloud()) return addPhotosCloud(files)
  return addPhotosLocal(files)
}

async function addPhotosCloud(files) {
  toast(`正在上传 ${files.length} 张照片到云端…`)
  let ok = 0, exifDate = 0, exifGps = 0
  const nextSort = (state.photos.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0)) + 1
  for (const file of files) {
    try {
      const meta = await extractMeta(file)                          // 原图上解析 EXIF
      const { path, url } = await uploadImageToStorage(file)          // 原图直传 Storage
      if (meta.date) exifDate++
      if (meta.coords) exifGps++
      const item = await insertPhotoMeta({                          // 元数据入库
        url, storagePath: path,
        date: meta.date || fmtDate(new Date(file.lastModified || Date.now())),
        location: '', coords: meta.coords, caption: '', tags: [], customTags: [],
        sortOrder: nextSort + ok
      })
      markPending(item.id)                                          // 抑制自己的 INSERT 回声
      // 竞态防护：Realtime 的 INSERT 推送可能先于本 REST 响应到达并已插入同 id 项，
      // 无脑 push 会造成 state.photos 出现重复项 → 删除/移动/渲染全部错乱。
      // （用户实测踩坑：批量上传后"无法删除、无法移动"即此因）
      if (!state.photos.some(p => p.id === item.id)) state.photos.push(item)
      ok++
    } catch (err) {
      console.warn('照片上传失败', file.name, err)
      toast(`「${file.name}」上传失败：${err.message || err}`, 'error')
    }
  }
  if (ok) {
    bus.emit('photos:changed', { added: ok })
    const notes = []
    if (exifDate) notes.push(`${exifDate} 张读取到拍摄时间`)
    if (exifGps) notes.push(`${exifGps} 张读取到 GPS`)
    toast(`已上传 ${ok} 张照片` + (notes.length ? `（${notes.join('，')}）` : ''))
  }
}

async function addPhotosLocal(files) {
  toast(`正在处理 ${files.length} 张照片…`)
  let ok = 0, exifDate = 0, exifGps = 0
  for (const file of files) {
    try {
      const [blob, meta] = await Promise.all([compressImage(file), extractMeta(file)])
      const id = uid()
      await idbPut(id, blob)
      if (meta.date) exifDate++
      if (meta.coords) exifGps++
      state.photos.push({
        id, url: bindUrl(id, blob), stored: true,
        date: meta.date || fmtDate(new Date(file.lastModified || Date.now())),
        location: '', coords: meta.coords,
        caption: '', tags: [], customTags: []
      })
      ok++
    } catch (err) { console.warn('照片处理失败', file.name, err) }
  }
  if (!ok) { toast('图片处理失败，请换一张试试', 'error'); return }
  persist()
  bus.emit('photos:changed', { added: ok })
  const notes = []
  if (exifDate) notes.push(`${exifDate} 张读取到拍摄时间`)
  if (exifGps) notes.push(`${exifGps} 张读取到 GPS`)
  toast(`已添加 ${ok} 张照片` + (notes.length ? `（${notes.join('，')}）` : ''))
}

/** 单项字段更新（就地编辑）：乐观更新 → 云端 UPDATE / 本地持久化 */
export function updatePhoto(id, patch) {
  const p = state.photos.find(x => x.id === id)
  if (!p) return
  Object.assign(p, patch)
  if (inCloud() && p.cloud) {
    markPending(id)
    updatePhotoMeta(id, patch).catch(err => {
      console.warn('云端更新失败', err)
      toast('云同步失败，本端已保存，稍后会重试', 'warn')
    })
  } else {
    persist()
  }
  bus.emit('photo:updated', { id })
}

/** 删除照片 */
export function removePhoto(id) {
  const i = state.photos.findIndex(x => x.id === id)
  if (i < 0) return
  const [p] = state.photos.splice(i, 1)
  if (inCloud() && p.cloud) {
    markPending(id)
    deletePhotoMeta(id).catch(err => console.warn('云端删除失败', err))
    if (p.storagePath) deleteStorageObject(p.storagePath)     // Storage 对象联动清理
  } else {
    const u = urlMap.get(id)
    if (u) { URL.revokeObjectURL(u); urlMap.delete(id) }
    if (p.stored) idbDel(id).catch(() => {})
    persist()
  }
  if (state.activeIdx >= state.photos.length) state.activeIdx = Math.max(0, state.photos.length - 1)
  bus.emit('photos:changed', { removed: id })
}

/** 上移 / 下移 */
export function movePhoto(id, dir) {
  const i = state.photos.findIndex(p => p.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= state.photos.length) return
  ;[state.photos[i], state.photos[j]] = [state.photos[j], state.photos[i]]
  syncOrderAfterMove()
}

/** 拖拽排序：按卡片 DOM 顺序重排 */
export function applyOrder(ids) {
  state.photos.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
  syncOrderAfterMove()
}

/** 排序落库/落本地（云模式批量 UPDATE sort_order） */
function syncOrderAfterMove() {
  const patches = state.photos.map((p, idx) => ({ id: p.id, sortOrder: idx }))
  state.photos.forEach((p, idx) => { p.sortOrder = idx })
  if (inCloud()) {
    state.photos.forEach(p => markPending(p.id))   // 批量回声去重
    updateSortOrders(patches)
  } else {
    persist()
  }
  bus.emit('photos:changed', { reordered: true })
}

/** 补图：图片缺失的卡片重新上传 */
export async function replacePhotoImage(id, file) {
  const p = state.photos.find(x => x.id === id)
  if (!p) return false
  try {
    if (inCloud() && p.cloud) {
      const { path, url } = await uploadImageToStorage(file)
      const oldPath = p.storagePath
      p.url = url; p.storagePath = path
      markPending(id)
      await updatePhotoMeta(id, { url, storagePath: path })
      if (oldPath) deleteStorageObject(oldPath)
    } else {
      const blob = await compressImage(file)
      await idbPut(id, blob)
      p.url = bindUrl(id, blob)
      p.stored = true
      persist()
    }
    bus.emit('photos:changed', { replaced: id })
    return true
  } catch (err) {
    console.warn('补图失败', err)
    return false
  }
}

/** 一键清除演示照片（仅本地模式存在演示数据） */
export function clearDemoPhotos() {
  state.photos = state.photos.filter(p => !p.demo)
  persist()
  bus.emit('photos:changed', { clearedDemo: true })
}

/** 展映当前页切换（fast=true 供侧栏 hover 快速联动） */
export function setActive(idx, { fast = false } = {}) {
  const i = Math.max(0, Math.min(state.photos.length - 1, idx))
  if (i === state.activeIdx) return
  state.activeIdx = i
  bus.emit('active:changed', { idx: i, fast })
}

/** 编辑 ↔ 展映 视图切换 */
export function setPresenting(v) {
  state.presenting = v
  bus.emit('view:changed', v)
}

/* ---------------- 主题 ---------------- */
export function setTheme(t) {
  state.theme = t
  document.documentElement.dataset.theme = t
  try { localStorage.setItem(LS_THEME, t) } catch { /* ignore */ }
  bus.emit('theme:changed', t)
}
export function toggleTheme() {
  setTheme(state.theme === 'dark' ? 'light' : 'dark')
}

/* ---------------- JSON 备份导入 ---------------- */
export async function importPhotosPayload(payload) {
  if (!payload || !Array.isArray(payload.photos)) throw new Error('bad format')
  const next = []
  for (const item of payload.photos) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id : uid()
    let url = '', stored = false
    if (typeof item.dataURL === 'string' && item.dataURL.startsWith('data:image')) {
      const blob = await (await fetch(item.dataURL)).blob()
      await idbPut(id, blob)
      url = bindUrl(id, blob)
      stored = true
    } else if (typeof item.remoteUrl === 'string' && /^https?:/.test(item.remoteUrl)) {
      url = item.remoteUrl
    }
    next.push({
      id, url, stored,
      remoteUrl: typeof item.remoteUrl === 'string' && /^https?:/.test(item.remoteUrl) ? item.remoteUrl : undefined,
      demo: !!item.demo,
      date: item.date || '', location: item.location || '',
      coords: item.coords && typeof item.coords.lat === 'number' ? item.coords : null,
      caption: item.caption || '',
      tags: Array.isArray(item.tags) ? item.tags : [],
      customTags: Array.isArray(item.customTags) ? item.customTags : []
    })
  }
  if (!next.length) throw new Error('empty')
  state.photos = next
  if (state.activeIdx >= next.length) state.activeIdx = 0
  persist()
  bus.emit('photos:changed', { imported: next.length })
  return next.length
}
