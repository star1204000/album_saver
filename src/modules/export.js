/* ============================================================
 * export.js · 导出模块
 * ------------------------------------------------------------
 * 1. 竖版拍立得拼贴长海报：html2canvas 以 2 倍分辨率渲染 720px 逻辑宽
 *    （白框 + 和纸胶带 + 交错旋转 + 标题落款，含预设与自定义标签）
 * 2. JSON 备份：元数据 + 图片数据（IndexedDB Blob → base64）完整打包，
 *    导入即恢复，换机换浏览器均可用
 * ============================================================ */
import html2canvas from 'html2canvas'
import { state, toast, importPhotosPayload } from './state.js'

const holder = document.getElementById('poster-canvas')

const pad2 = n => String(n).padStart(2, '0')
const dateStamp = () => {
  const d = new Date()
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function downloadBlob(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

/* ---------------- 日期范围（海报副标题） ---------------- */
function getDateRange() {
  const ds = state.photos.map(p => (p.date || '').trim()).filter(d => /^\d{4}[.\-/]\d{1,2}([.\-/]\d{1,2})?$/.test(d))
  if (!ds.length) return '2026 之夏'
  ds.sort()
  const f = s => s.replace(/[/-]/g, '.')
  return ds.length === 1 ? f(ds[0]) : `${f(ds[0])} — ${f(ds[ds.length - 1])}`
}

/* ---------------- 拍立得拼贴海报 ---------------- */
function buildPosterDOM() {
  const rots = [-2.3, 1.9, -1.5, 2.4, -2.0, 1.4, -1.1, 2.1, -1.7, 1.6]
  const n = state.photos.length
  const cards = state.photos.map((p, i) => {
    const wide = (n % 2 === 1 && i === n - 1)   // 奇数张时最后一张通栏
    const allTags = [...p.tags, ...p.customTags]
    return `
    <div class="polaroid${wide ? ' polaroid-wide' : ''}" style="transform:rotate(${rots[i % rots.length]}deg)">
      <div class="tape" style="transform:translateX(-50%) rotate(${(i % 3 - 1) * 5}deg)"></div>
      <img src="${esc(p.url)}" alt="${esc(p.location)}">
      <div class="polaroid-cap">
        <div class="pc-top"><span class="pc-loc">${esc(p.location) || '未命名地点'}</span><span class="pc-date">${esc(p.date)}</span></div>
        ${p.caption ? `<p class="pc-caption">“${esc(p.caption)}”</p>` : ''}
        ${allTags.length ? `<div class="pc-tags">${allTags.map(esc).join(' · ')}</div>` : ''}
      </div>
    </div>`
  }).join('')
  holder.innerHTML = `
  <div class="poster-root">
    <div class="poster-head">
      <p class="ph-eyebrow">SUMMER MEMORIES</p>
      <h1 class="ph-title">我的暑假记忆</h1>
      <p class="ph-sub">${getDateRange()} · ${n} 个瞬间</p>
      <div class="ph-orn">— ☀ —</div>
    </div>
    <div class="poster-grid">${cards}</div>
    <div class="poster-foot">
      <p class="pf-line">这个夏天，被好好记住了</p>
      <p class="pf-meta">SUMMER MEMORIES ALBUM · ${new Date().getFullYear()}</p>
    </div>
  </div>`
  return holder.firstElementChild
}

function imagesLoaded(root) {
  return Promise.all([...root.querySelectorAll('img')].map(im =>
    (im.complete && im.naturalWidth) ? Promise.resolve()
      : new Promise(r => { im.addEventListener('load', r, { once: true }); im.addEventListener('error', r, { once: true }) })
  ))
}

async function renderPosterCanvas() {
  if (!state.photos.length) throw new Error('no photos')
  const root = buildPosterDOM()
  try { await document.fonts.ready } catch { /* ignore */ }
  await imagesLoaded(root)
  return await html2canvas(root, {
    scale: 2, useCORS: true, backgroundColor: '#FBF9F4',
    width: 720, windowWidth: 720, scrollX: 0, scrollY: 0, logging: false
  })
}

export async function exportPoster() {
  if (!state.photos.length) { toast('请先添加照片', 'warn'); return }
  toast('正在生成夏日记忆海报…')
  try {
    const canvas = await renderPosterCanvas()
    canvas.toBlob(blob => {
      if (!blob) { toast('海报生成失败，请重试', 'error'); return }
      downloadBlob(blob, `夏日记忆海报-${dateStamp()}.png`)
      toast('海报已导出，请查看浏览器下载')
    }, 'image/png')
  } catch (err) {
    console.error(err)
    toast('海报生成失败，请重试', 'error')
  }
}

/* ---------------- JSON 备份导出 / 导入 ---------------- */

/** IndexedDB Blob → base64 dataURL */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

async function fetchStoredBlob(id) {
  // 复用 state.js 的读取通道：图片 Blob 都在 IndexedDB，以 photo.url(objectURL) 反查
  const p = state.photos.find(x => x.id === id)
  if (!p?.url || !p.url.startsWith('blob:')) return null
  try { return await (await fetch(p.url)).blob() } catch { return null }
}

export async function exportJSON() {
  if (!state.photos.length) { toast('还没有可导出的数据', 'warn'); return }
  toast('正在打包 JSON 备份…')
  const payload = {
    app: 'summer-memory-album', version: 1,
    exportedAt: new Date().toISOString(),
    photos: await Promise.all(state.photos.map(async p => ({
      id: p.id, date: p.date, location: p.location, coords: p.coords,
      caption: p.caption, tags: p.tags, customTags: p.customTags,
      demo: !!p.demo,
      // 云模式 url 即 Storage 公开地址；本地模式导出 blob 对应的 base64
      remoteUrl: p.url && !p.url.startsWith('blob:') ? p.url : (p.remoteUrl || ''),
      dataURL: p.stored ? (await (async () => {
        const b = await fetchStoredBlob(p.id)
        return b ? blobToDataURL(b) : ''
      })()) : ''
    })))
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `夏日记忆备份-${dateStamp()}.json`)
  toast(`已导出 ${state.photos.length} 条记录（含图片数据）`)
}

export async function importJSON(file) {
  const text = await file.text()
  let payload
  try { payload = JSON.parse(text) } catch { toast('JSON 文件格式不正确', 'error'); return }
  try {
    const n = await importPhotosPayload(payload)
    toast(`已载入 ${n} 条记录`)
  } catch (err) {
    console.warn(err)
    toast('JSON 文件格式不正确', 'error')
  }
}
