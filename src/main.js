/* ============================================================
 * main.js · 应用主入口
 * ------------------------------------------------------------
 * 职责：
 *   1. 启动初始化：hydrate 恢复数据 → 首次访问填充演示照片
 *   2. 视图路由：编辑视图 ↔ 全屏展映（bus 'view:changed'）
 *   3. 文件上传绑定：拖拽 / 选择器 / 缺图补传 / 全局拖拽兜底
 *   4. 编辑视图渲染：照片卡片网格 + 元数据就地编辑 + 标签系统
 *   5. Toast 渲染（各模块经 bus.emit('toast') 统一走这里）
 * ============================================================ */
import './styles/main.css'
import { createIcons } from 'lucide'
import { iconRegistry } from './modules/icons.js'
import { initCloud } from './modules/cloud.js'
import {
  bus, state, hydrate, addPhotos, updatePhoto, removePhoto,
  movePhoto, applyOrder, replacePhotoImage, clearDemoPhotos,
  setActive, setPresenting, setTheme, toggleTheme, toast
} from './modules/state.js'
import { initSidebar } from './modules/sidebar.js'
import { initStage } from './modules/stage.js'
import { exportPoster, exportJSON, importJSON } from './modules/export.js'
import { initTauriTitlebar } from './modules/tauri-titlebar.js'
import { autoFillLocations } from './modules/geo.js'

/* ---------------- 演示数据（首次访问预填，开箱即用） ---------------- */
const DEMO_PHOTOS = [
  {
    id: 'demo-1', demo: true,
    remoteUrl: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?q=80&w=1920&auto=format&fit=crop',
    date: '2026.07.15', location: '青海湖 · 黑马河', coords: { lat: 36.71667, lng: 100.75000 },
    caption: '那天的落日，被永远定格在了风里',
    tags: ['☀️ 晴天', '🌇 落日'], customTags: ['#毕业旅行']
  },
  {
    id: 'demo-2', demo: true,
    remoteUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=1920&auto=format&fit=crop',
    date: '2026.07.22', location: '厦门 · 环岛路', coords: { lat: 24.43600, lng: 118.10000 },
    caption: '单车、椰影，和一整条被晒亮的海岸线',
    tags: ['🌊 海风', '🍃 漫游'], customTags: ['#环岛骑行']
  },
  {
    id: 'demo-3', demo: true,
    remoteUrl: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?q=80&w=1920&auto=format&fit=crop',
    date: '2026.08.02', location: '大理 · 洱海', coords: { lat: 25.75000, lng: 100.18333 },
    caption: '苍山不语，云朵在慢慢散步',
    tags: ['🍃 漫游', '🚗 自驾'], customTags: []
  },
  {
    id: 'demo-4', demo: true,
    remoteUrl: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?q=80&w=1920&auto=format&fit=crop',
    date: '2026.08.10', location: '老城 · 夜市', coords: null,
    caption: '烟火气里，喝下夏天的最后一口冰',
    tags: ['🌙 夜聊', '🍧 甜品'], customTags: ['#夏日限定']
  }
]

const PRESET_TAGS = [
  '☀️ 晴天', '⛅ 多云', '🌧️ 雨天', '🌊 海风', '🍃 漫游', '🌇 落日',
  '🍉 西瓜', '🚗 自驾', '🥾 徒步', '🎤 音乐节', '🌙 夜聊', '🍧 甜品',
  '📷 扫街', '🏊 泳池', '⛰️ 登山', '🎪 游乐园'
]

/* ---------------- DOM 引用 ---------------- */
const galleryEl = document.getElementById('gallery')
const dropzoneEl = document.getElementById('dropzone')
const fileInputEl = document.getElementById('file-input')
const replaceInputEl = document.getElementById('replace-input')
const importInputEl = document.getElementById('import-input')
const presentViewEl = document.getElementById('present-view')

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const refreshIcons = () => createIcons({ icons: iconRegistry })

/* ============================================================
 * 视图路由：编辑 ↔ 展映
 * ============================================================ */
function enterPresentation() {
  if (!state.photos.length) { toast('请先添加照片', 'warn'); return }
  state.activeIdx = 0
  setPresenting(true)
}

bus.on('view:changed', presenting => {
  document.documentElement.classList.toggle('no-scroll', presenting)
  if (presenting) {
    presentViewEl.hidden = false
    requestAnimationFrame(() => requestAnimationFrame(() => presentViewEl.classList.add('show')))
    bus.emit('active:changed', { idx: 0, fast: false })   // 通知舞台回到第一页
  } else {
    presentViewEl.classList.remove('show')
    setTimeout(() => { presentViewEl.hidden = true }, 550)
  }
})

/* ============================================================
 * Toast 渲染（唯一出口）
 * ============================================================ */
bus.on('toast', ({ msg, type }) => {
  const el = document.createElement('div')
  el.className = 'toast' + (type === 'error' ? ' error' : type === 'warn' ? ' warn' : '')
  const icon = type === 'error' ? 'alert-circle' : (type === 'warn' ? 'info' : 'check-circle-2')
  el.innerHTML = `<i data-lucide="${icon}"></i><span>${esc(msg)}</span>`
  document.getElementById('toast-root').appendChild(el)
  refreshIcons()
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450) }, 2800)
})

/* ============================================================
 * 编辑视图渲染
 * ============================================================ */
const openTagPanels = new Set()   // 展开标签面板的卡片 id
let pendingReplaceId = null       // 待补图的卡片 id

function cardHTML(p, i) {
  const remote = !p.stored   // 演示照片（远程 URL）直接给 src；本地图 objectURL 同步可用
  return `
  <article class="card" data-id="${p.id}">
    <div class="card-media">
      ${p.url ? `<img src="${esc(p.url)}" alt="照片 ${i + 1}" loading="lazy">` : ''}
      <span class="badge-index">${i + 1}</span>
      <div class="card-tools">
        <button class="tool-btn" data-act="drag" title="按住拖拽排序"><i data-lucide="grip-vertical"></i></button>
        <button class="tool-btn" data-act="up" title="上移"><i data-lucide="chevron-up"></i></button>
        <button class="tool-btn" data-act="down" title="下移"><i data-lucide="chevron-down"></i></button>
        <button class="tool-btn danger" data-act="delete" title="删除"><i data-lucide="trash-2"></i></button>
      </div>
      <div class="media-missing" data-replace="${p.id}" hidden>
        <i data-lucide="image-off"></i>
        <p>图片缺失</p><span>点击重新上传</span>
      </div>
    </div>
    <div class="card-body">
      <div class="grid grid-cols-2 gap-2.5 mb-2.5">
        <label class="field"><i data-lucide="calendar" class="field-ic"></i><input class="input" data-field="date" value="${esc(p.date)}" placeholder="2026.07.15"></label>
        <label class="field"><i data-lucide="map-pin" class="field-ic"></i><input class="input" data-field="location" value="${esc(p.location)}" placeholder="打卡地点"></label>
      </div>
      <textarea class="textarea" data-field="caption" rows="2" placeholder="写一句属于这张照片的夏日记忆…">${esc(p.caption)}</textarea>
      ${p.coords
        ? `<span class="coord-chip" title="EXIF GPS 经纬度"><i data-lucide="navigation"></i>${p.coords.lat.toFixed(3)}°, ${p.coords.lng.toFixed(3)}°</span>`
        : ''}
      <div class="tags-wrap mt-2.5" data-id="${p.id}">${tagsHTML(p)}</div>
    </div>
  </article>`
}

function tagsHTML(p) {
  const open = openTagPanels.has(p.id)
  return `
    <div class="chips">
      ${p.tags.map(t => `<button class="chip chip-on" data-act="untag" data-tag="${esc(t)}" title="点击移除">${esc(t)}</button>`).join('')}
      ${p.customTags.map(t => `<button class="chip chip-on" data-act="uncustom" data-tag="${esc(t)}" title="点击移除">${esc(t)}</button>`).join('')}
      <button class="chip chip-add" data-act="toggle-panel">${open ? '收起' : '＋ 标签'}</button>
    </div>
    <div class="ct-row">
      <input class="ct-input" type="text" data-ct-input placeholder="自定义标签，如 #毕业旅行" maxlength="12">
      <button class="ct-add-btn" type="button" data-act="add-custom" title="添加自定义标签">＋</button>
    </div>
    <div class="tag-panel ${open ? 'open' : ''}">
      ${PRESET_TAGS.map(t => `<button class="chip ${p.tags.includes(t) ? 'chip-on' : ''}" data-act="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>`
}

/** 自定义标签：统一 # 前缀，去重，上限长度 12 */
function addCustomTag(p, raw) {
  let t = String(raw || '').trim().replace(/^#+/, '').slice(0, 12)
  if (!t) return false
  t = '#' + t
  if (p.customTags.includes(t) || p.tags.includes(t)) return false
  p.customTags.push(t)
  return true
}

function renderGallery() {
  galleryEl.innerHTML = state.photos.length
    ? state.photos.map(cardHTML).join('')
    : `<div class="empty-state"><i data-lucide="wind"></i><p>还没有照片 · 从上方上传你的夏天吧</p></div>`
  renderStats()
  refreshIcons()
}

/**
 * 单卡片重绘（远端实时更新专用）：
 * 只替换目标卡片 DOM，不打断本端正在进行的输入（焦点/选区保留）。
 * 远端 UPDATE 经 photo:updated 广播 → 此处同步到卡片；
 * 本端自己的编辑也走同一事件，但字段已是当前值，重绘无害。
 */
function renderCard(id) {
  const idx = state.photos.findIndex(p => p.id === id)
  const cardEl = galleryEl.querySelector(`.card[data-id="${id}"]`)
  if (idx < 0) { if (cardEl) cardEl.remove(); renderStats(); return }
  const fresh = cardHTML(state.photos[idx], idx)
  if (cardEl) {
    // 若焦点在目标卡片内（正在输入），跳过重绘避免打断
    if (cardEl.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return
    cardEl.outerHTML = fresh
  } else {
    galleryEl.insertAdjacentHTML('beforeend', fresh)
  }
  renderStats()
  refreshIcons()
}

function renderStats() {
  const n = state.photos.length
  const locs = new Set(state.photos.map(p => (p.location || '').trim()).filter(Boolean)).size
  const title = document.getElementById('hero-title')
  title.innerHTML = n ? `我的暑假，<em>${n} 个瞬间</em>` : '把夏天，装进一本相册'
  document.getElementById('hero-sub').textContent = n
    ? `${dateRangeText()} · ${locs} 个地点 · 点击「进入展映」开始沉浸式回顾`
    : '上传照片，写下当时的心情，然后进入沉浸式展映'
  document.getElementById('clear-demo').hidden = !state.photos.some(p => p.demo)
  dropzoneEl.classList.toggle('compact', n > 0)
}

function dateRangeText() {
  const ds = state.photos.map(p => (p.date || '').trim()).filter(d => /^\d{4}[.\-/]\d{1,2}([.\-/]\d{1,2})?$/.test(d))
  if (!ds.length) return '2026 之夏'
  ds.sort()
  const f = s => s.replace(/[/-]/g, '.')
  return ds.length === 1 ? f(ds[0]) : `${f(ds[0])} — ${f(ds[ds.length - 1])}`
}

/* ---------------- 编辑视图事件 ---------------- */
function bindEditEvents() {
  // 上传区
  dropzoneEl.addEventListener('click', () => fileInputEl.click())
  dropzoneEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputEl.click() } })
  dropzoneEl.addEventListener('dragover', e => { e.preventDefault(); dropzoneEl.classList.add('dragover') })
  dropzoneEl.addEventListener('dragleave', () => dropzoneEl.classList.remove('dragover'))
  dropzoneEl.addEventListener('drop', e => {
    e.preventDefault(); dropzoneEl.classList.remove('dragover')
    if (e.dataTransfer.files.length) addPhotos(e.dataTransfer.files)
  })
  fileInputEl.addEventListener('change', e => {
    if (e.target.files.length) addPhotos(e.target.files)
    e.target.value = ''
  })

  // 补图
  replaceInputEl.addEventListener('change', async e => {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f || !pendingReplaceId) return
    const id = pendingReplaceId
    pendingReplaceId = null
    toast((await replacePhotoImage(id, f)) ? '图片已恢复' : '图片处理失败', (await Promise.resolve()) ? 'ok' : 'error')
  })

  // JSON 导入
  importInputEl.addEventListener('change', e => {
    const f = e.target.files[0]
    e.target.value = ''
    if (f) importJSON(f)
  })

  // 元数据就地编辑（事件委托：只改数据不重绘，不打断输入）
  galleryEl.addEventListener('input', e => {
    const field = e.target.dataset.field
    if (!field) return
    const card = e.target.closest('.card')
    const p = card && state.photos.find(x => x.id === card.dataset.id)
    if (!p) return
    updatePhoto(p.id, { [field]: e.target.value })
  })

  // 自定义标签：输入框内回车即添加（保持焦点可连续输入）
  galleryEl.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('[data-ct-input]')) return
    e.preventDefault()
    const card = e.target.closest('.card')
    const p = card && state.photos.find(x => x.id === card.dataset.id)
    if (!p) return
    const wrap = e.target.closest('.tags-wrap')
    if (addCustomTag(p, e.target.value)) {
      updatePhoto(p.id, {})   // 触发持久化
      wrap.innerHTML = tagsHTML(p)
      wrap.querySelector('[data-ct-input]')?.focus()
    } else {
      e.target.classList.add('ct-shake')
      setTimeout(() => e.target.classList.remove('ct-shake'), 400)
    }
  })

  // 卡片按钮 / 标签 / 补图点击
  galleryEl.addEventListener('click', e => {
    const card = e.target.closest('.card')
    if (!card) return
    const id = card.dataset.id
    const idx = state.photos.findIndex(p => p.id === id)
    if (idx < 0) return
    const p = state.photos[idx]

    const btn = e.target.closest('[data-act]')
    if (btn) {
      const act = btn.dataset.act
      if (act === 'up') movePhoto(id, -1)
      else if (act === 'down') movePhoto(id, 1)
      else if (act === 'delete') confirmDelete(btn, id)
      else if (act === 'toggle-panel') {
        openTagPanels.has(id) ? openTagPanels.delete(id) : openTagPanels.add(id)
        btn.closest('.tags-wrap').innerHTML = tagsHTML(p)
      } else if (act === 'tag') {
        const t = btn.dataset.tag
        if (!p.tags.includes(t)) p.tags.push(t)
        updatePhoto(id, {}); btn.closest('.tags-wrap').innerHTML = tagsHTML(p)
      } else if (act === 'untag') {
        p.tags = p.tags.filter(x => x !== btn.dataset.tag)
        updatePhoto(id, {}); btn.closest('.tags-wrap').innerHTML = tagsHTML(p)
      } else if (act === 'uncustom') {
        p.customTags = p.customTags.filter(x => x !== btn.dataset.tag)
        updatePhoto(id, {}); btn.closest('.tags-wrap').innerHTML = tagsHTML(p)
      } else if (act === 'add-custom') {
        const wrap = btn.closest('.tags-wrap')
        const input = wrap.querySelector('[data-ct-input]')
        if (input && addCustomTag(p, input.value)) {
          updatePhoto(id, {})
          wrap.innerHTML = tagsHTML(p)
          wrap.querySelector('[data-ct-input]')?.focus()
        } else if (input) {
          input.classList.add('ct-shake')
          setTimeout(() => input.classList.remove('ct-shake'), 400)
        }
      }
      return
    }

    const miss = e.target.closest('[data-replace]')
    if (miss) { pendingReplaceId = miss.dataset.replace; replaceInputEl.click() }
  })

  // 图片加载失败 → 缺图占位
  galleryEl.addEventListener('error', e => {
    if (e.target.tagName === 'IMG') {
      const card = e.target.closest('.card')
      if (card) {
        e.target.style.display = 'none'
        card.querySelector('.media-missing')?.removeAttribute('hidden')
        card.classList.add('media-missing-card')
      }
    }
  }, true)

  // 拖拽排序：仅从 ⠿ 把手发起，避免与输入框选中文本冲突
  let dragCard = null
  galleryEl.addEventListener('mousedown', e => {
    const h = e.target.closest('[data-act="drag"]')
    if (h) h.closest('.card').draggable = true
  })
  galleryEl.addEventListener('dragstart', e => {
    const c = e.target.closest('.card')
    if (!c || !c.draggable) return
    dragCard = c; c.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', c.dataset.id) } catch { /* ignore */ }
  })
  galleryEl.addEventListener('dragend', e => {
    const c = e.target.closest('.card')
    if (c) { c.draggable = false; c.classList.remove('dragging') }
  })
  galleryEl.addEventListener('dragover', e => {
    if (!dragCard) return
    e.preventDefault()
    const after = [...galleryEl.querySelectorAll('.card:not(.dragging)')].reduce((closest, c) => {
      const box = c.getBoundingClientRect()
      const offset = e.clientY - box.top - box.height / 2
      return (offset < 0 && offset > closest.offset) ? { offset, el: c } : closest
    }, { offset: -Infinity, el: null }).el
    if (after == null) galleryEl.appendChild(dragCard)
    else if (after !== dragCard) galleryEl.insertBefore(dragCard, after)
  })
  galleryEl.addEventListener('drop', e => {
    if (!dragCard) return
    e.preventDefault()
    applyOrder([...galleryEl.querySelectorAll('.card')].map(c => c.dataset.id))
    dragCard = null
  })

  // 清除示例照片
  document.getElementById('clear-demo').addEventListener('click', () => {
    clearDemoPhotos()
    toast('已清除示例照片')
  })
}

/** 两击确认删除，避免误触 */
function confirmDelete(btn, id) {
  if (btn.dataset.armed) {
    removePhoto(id)
    toast('已删除照片')
  } else {
    btn.dataset.armed = '1'
    btn.classList.add('confirm')
    btn.title = '再点一次确认删除'
    toast('再点一次「删除」确认移除照片', 'warn')
    setTimeout(() => { btn.dataset.armed = ''; btn.classList.remove('confirm'); btn.title = '删除' }, 2400)
  }
}

/* ============================================================
 * 顶部导航 & 主题
 * ============================================================ */
function bindHeaderEvents() {
  document.getElementById('btn-present').addEventListener('click', enterPresentation)
  document.getElementById('btn-theme').addEventListener('click', toggleTheme)
  document.getElementById('btn-theme-present').addEventListener('click', toggleTheme)
  document.getElementById('btn-export-poster').addEventListener('click', exportPoster)
  document.getElementById('btn-export-json').addEventListener('click', exportJSON)
  document.getElementById('btn-import').addEventListener('click', () => importInputEl.click())

  bus.on('theme:changed', t => {
    document.querySelectorAll('[data-theme-icon]').forEach(b => {
      b.innerHTML = `<i data-lucide="${t === 'dark' ? 'sun' : 'moon'}"></i>`
    })
    refreshIcons()
  })

  // 全局兜底：防止拖拽文件时浏览器直接打开图片
  ;['dragover', 'drop'].forEach(t =>
    document.addEventListener(t, e => {
      if (!e.target.closest('#dropzone') && !e.target.closest('#gallery')) e.preventDefault()
    })
  )
}

/* ============================================================
 * 云同步状态徽章（头部）
 * ============================================================ */
function updateConnBadge({ mode, state: st, reason }) {
  const badge = document.getElementById('conn-badge')
  if (!badge) return
  const txt = badge.querySelector('.conn-txt')
  badge.classList.remove('ok', 'off', 'local')
  if (mode === 'cloud') {
    badge.classList.add(st === 'connected' ? 'ok' : 'off')
    txt.textContent = st === 'connected' ? '云同步' : '已断线'
    badge.title = st === 'connected'
      ? 'Supabase Realtime 已连接：多端实时同步中'
      : `云连接中断（${reason || '重连中'}）· 点击重连`
  } else {
    badge.classList.add('local')
    txt.textContent = '本地模式'
    badge.title = '未配置云服务，数据仅存本机浏览器 · 配置方法见项目 README'
  }
  refreshIcons()
}

function bindConnBadge() {
  bus.on('cloud:status', updateConnBadge)
  document.getElementById('conn-badge').addEventListener('click', () => {
    if (state.cloudReady) {
      toast('正在重新连接云服务…')
      setTimeout(() => location.reload(), 600)
    } else {
      toast('当前为纯本地模式：配置 .env.local（Supabase）即可开启多端同步，详见 README', 'warn')
    }
  })
}

/* ============================================================
 * 启动
 * ============================================================ */
async function init() {
  initSidebar()
  initStage()
  bindEditEvents()
  bindHeaderEvents()
  bindConnBadge()
  initTauriTitlebar()   // Tauri 壳内显示自绘窗口控制；浏览器零影响

  bus.on('photos:changed', renderGallery)
  bus.on('photo:updated', ({ id }) => renderCard(id))   // 远端实时更新 → 单卡片重绘
  bus.on('photos:changed', e => { if (e.added && state.cloudReady) autoFillLocations() })   // 新照片自动补地名

  // 云初始化：探测 .env 配置（Supabase 全配齐 → 云同步；否则本地模式）
  const cloudInit = await initCloud()
  state.cloudReady = cloudInit.mode === 'cloud'

  // 数据恢复（云模式：全量拉取 + Realtime 订阅；本地模式：IndexedDB + localStorage）
  const restored = await hydrate()
  if (state.cloudReady) autoFillLocations()   // 有 GPS 但地点为空的老照片也自动补全

  if (!restored) {
    if (cloudInit.mode === 'cloud') {
      // 云端空相册：等待用户上传（手机拍照直传）
      setTimeout(() => toast('云端相册还是空的，上传第一张照片吧'), 900)
    } else {
      // 首次访问（本地模式）→ 预填演示数据
      state.photos = DEMO_PHOTOS.map(p => ({ ...p, tags: [...p.tags], customTags: [...p.customTags], url: p.remoteUrl }))
      try { localStorage.setItem('sm-album:photos:v1', JSON.stringify(state.photos.map(({ url, ...rest }) => rest))) } catch { /* ignore */ }
      setTimeout(() => toast('已预填 4 张示例照片（含 EXIF GPS 演示），上传你的照片即可替换'), 900)
    }
  }

  // 主题图标 + 统一触发首次构建（编辑区 / 侧栏 / 舞台均订阅 photos:changed）
  setTheme(state.theme)
  bus.emit('photos:changed', { initial: true })
  refreshIcons()
}

init()
