/* ============================================================
 * stage.js · 展映模式右侧主舞台
 * ------------------------------------------------------------
 * - 全屏幻灯片：背景高斯模糊 + Ken Burns 推拉 + 鼠标视差
 * - 切页核心：轨道 translateY(-i * 100%)，纯 transform 合成层动画
 *   · 常规切换 .9s / hover 快速联动 .55s（CSS 变量 --slide-dur）
 *   · O(1) 增量 active 更新（元素缓存，不全量查询 DOM）
 * - 悬浮元数据卡片：日期 / 地点 / 文案 / 预设+自定义标签 / GPS 经纬度
 * - 交互：键盘 ↑↓←→/空格/Home/End/Esc、滚轮（节流）、触控滑动、
 *         侧边进度线、胶片缩略条（移动端）
 * - 地图足迹占位卡：预留 renderMapWidget(location, container) 接口
 * ============================================================ */
import { createIcons } from 'lucide'
import { iconRegistry } from './icons.js'
import { bus, state, setActive, setPresenting, toggleTheme } from './state.js'
import { formatCoords } from './exif.js'

const PLACEHOLDER_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

const stageEl = document.getElementById('present-stage')
const trackEl = document.getElementById('slides-track')
const progressEl = document.getElementById('present-progress')
const filmstripEl = document.getElementById('filmstrip')
const hintEl = document.getElementById('present-hint')

let slideEls = [], segEls = [], thumbEls = []   // 元素缓存

/* ---------------- 渲染 ---------------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function slideHTML(p, i, total) {
  const allTags = [...p.tags, ...p.customTags]
  return `
  <section class="slide" data-i="${i}">
    <div class="slide-bg"><img alt="" data-lazysrc></div>
    <div class="slide-inner">
      <figure class="slide-figure"><img class="slide-img" alt="${esc(p.location) || '照片'}" data-lazysrc></figure>
      <aside class="slide-card">
        <p class="sc-date">${esc(p.date) || '· · ·'}</p>
        <h3 class="sc-loc">${esc(p.location) || '未命名地点'}</h3>
        <div class="sc-divider"></div>
        ${p.caption ? `<p class="sc-caption">“${esc(p.caption)}”</p>` : ''}
        ${allTags.length ? `<div class="sc-tags">${p.tags.map(t => `<span class="sc-chip">${esc(t)}</span>`).join('')}${p.customTags.map(t => `<span class="sc-chip custom">${esc(t)}</span>`).join('')}</div>` : ''}
        <!-- 地图足迹 · 预留容器：后续由 renderMapWidget(location, container) 无缝接入 Leaflet / 高德地图 -->
        <div class="map-slot" id="map-widget-${i}" data-location="${esc(p.location)}" data-coords='${p.coords ? JSON.stringify(p.coords) : 'null'}'>
          <span class="map-slot-icon"><i data-lucide="map"></i></span>
          <div class="map-slot-text">
            <b>地图足迹</b>
            <small>${p.coords ? formatCoords(p.coords) + ' · ' : (p.location ? esc(p.location) + ' · ' : '')}即将上线</small>
          </div>
          <span class="map-slot-badge">SOON</span>
        </div>
      </aside>
    </div>
    <div class="slide-counter"><b>${String(i + 1).padStart(2, '0')}</b><span>/ ${String(total).padStart(2, '0')}</span></div>
  </section>`
}

function buildSlides() {
  const total = state.photos.length
  if (!total) {
    trackEl.innerHTML = ''; progressEl.innerHTML = ''; filmstripEl.innerHTML = ''
    slideEls = []; segEls = []; thumbEls = []
    return
  }
  trackEl.innerHTML = state.photos.map((p, i) => slideHTML(p, i, total)).join('')
  progressEl.innerHTML = state.photos.map((_, i) => `<button class="pseg" data-i="${i}" aria-label="第 ${i + 1} 张"></button>`).join('')
  filmstripEl.innerHTML = state.photos.map((p, i) => `<button class="fthumb" data-i="${i}" aria-label="第 ${i + 1} 张"><img src="${esc(p.url)}" alt="" loading="lazy"></button>`).join('')
  createIcons({ icons: iconRegistry })
  slideEls = [...trackEl.querySelectorAll('.slide')]
  segEls = [...progressEl.querySelectorAll('.pseg')]
  thumbEls = [...filmstripEl.querySelectorAll('.fthumb')]
  goTo(state.activeIdx, { instant: true })
  loadSlide(0); loadSlide(1)   // 预加载前两张
}

/** 懒加载指定页大图（当前页 ±1） */
async function loadSlide(i) {
  const p = state.photos[i]
  if (!p) return
  slideEls[i]?.querySelectorAll('img[data-lazysrc]').forEach(im => {
    im.src = p.url || PLACEHOLDER_GIF
    im.removeAttribute('data-lazysrc')
    if (!p.url) im.closest('.slide')?.classList.add('no-photo')
  })
}

/**
 * 切页核心
 * @param {number} i 目标索引
 * @param {{fast?:boolean, instant?:boolean}} opts
 *   fast    侧栏 hover 联动：.55s 短过渡
 *   instant 构建后瞬时定位（无动画）
 */
function goTo(i, { fast = false, instant = false } = {}) {
  const total = state.photos.length
  if (!total) return
  i = Math.max(0, Math.min(total - 1, i))
  trackEl.style.setProperty('--slide-dur', fast ? '.55s' : '.9s')
  if (instant) {
    trackEl.style.transition = 'none'
    trackEl.style.transform = `translateY(-${i * 100}%)`
    void trackEl.offsetHeight            // 强制回流，确保瞬时定位
    trackEl.style.transition = ''
  } else {
    trackEl.style.transform = `translateY(-${i * 100}%)`
  }
  // active 态更新（DOM 查询式清理：不依赖 state.activeIdx 旧值，天然幂等）
  trackEl.querySelector('.slide.active')?.classList.remove('active')
  progressEl.querySelector('.pseg.on')?.classList.remove('on')
  filmstripEl.querySelector('.fthumb.on')?.classList.remove('on')
  state.activeIdx = i
  slideEls[i]?.classList.add('active')
  segEls[i]?.classList.add('on')
  thumbEls[i]?.classList.add('on')
  loadSlide(i); loadSlide(i - 1); loadSlide(i + 1)   // 当前页（hover 跳页直达）+ 前后预加载
  const img = slideEls[i]?.querySelector('.slide-img')
  if (img) { img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '' }  // 重启 Ken Burns
  thumbEls[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
}

/* ---------------- 事件绑定 ---------------- */

function showHint() {
  hintEl.classList.remove('fade')
  clearTimeout(hintEl._t)
  hintEl._t = setTimeout(() => hintEl.classList.add('fade'), 3800)
}

function bindStageEvents() {
  document.getElementById('btn-exit-present').addEventListener('click', () => setPresenting(false))
  document.getElementById('btn-theme-present').addEventListener('click', toggleTheme)
  stageEl.querySelector('.present-nav.prev').addEventListener('click', () => setActive(state.activeIdx - 1))
  stageEl.querySelector('.present-nav.next').addEventListener('click', () => setActive(state.activeIdx + 1))

  progressEl.addEventListener('click', e => {
    const b = e.target.closest('.pseg'); if (b) setActive(+b.dataset.i)
  })
  filmstripEl.addEventListener('click', e => {
    const b = e.target.closest('.fthumb'); if (b) setActive(+b.dataset.i)
  })

  // 滚轮：累积阈值 + 节流，一次滚动只切一页（绑定在主舞台，侧栏列表滚动互不影响）
  let wheelLock = false, acc = 0, accT = null
  stageEl.addEventListener('wheel', e => {
    if (!state.presenting) return
    e.preventDefault()
    if (wheelLock) return
    acc += e.deltaY
    clearTimeout(accT); accT = setTimeout(() => acc = 0, 180)
    if (Math.abs(acc) > 28) {
      setActive(state.activeIdx + (acc > 0 ? 1 : -1))
      acc = 0; wheelLock = true
      setTimeout(() => wheelLock = false, 1050)
    }
  }, { passive: false })

  // 触控：纵滑切页，横滑也支持
  let ty = null, tx = null
  stageEl.addEventListener('touchstart', e => { ty = e.touches[0].clientY; tx = e.touches[0].clientX }, { passive: true })
  stageEl.addEventListener('touchend', e => {
    if (ty === null || !state.presenting) return
    const dy = e.changedTouches[0].clientY - ty
    const dx = e.changedTouches[0].clientX - tx
    if (Math.abs(dy) > 52 && Math.abs(dy) > Math.abs(dx)) setActive(state.activeIdx + (dy < 0 ? 1 : -1))
    else if (Math.abs(dx) > 62) setActive(state.activeIdx + (dx < 0 ? 1 : -1))
    ty = null
  }, { passive: true })

  // 键盘：↑↓/PgUp·PgDn/空格/←→/Home/End/Esc
  document.addEventListener('keydown', e => {
    if (!state.presenting) return
    if (['ArrowDown', 'PageDown', 'ArrowRight', ' '].includes(e.key)) { e.preventDefault(); setActive(state.activeIdx + 1) }
    else if (['ArrowUp', 'PageUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); setActive(state.activeIdx - 1) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(state.photos.length - 1) }
    else if (e.key === 'Escape') setPresenting(false)
  })

  // 背景视差：鼠标移动时模糊底图轻微反向位移
  stageEl.addEventListener('mousemove', e => {
    if (!state.presenting || e.pointerType === 'touch') return
    const x = e.clientX / innerWidth - 0.5
    const y = e.clientY / innerHeight - 0.5
    trackEl.querySelector('.slide.active .slide-bg img') &&
      trackEl.querySelectorAll('.slide.active .slide-bg img').forEach(im => {
        im.style.transform = `scale(1.15) translate(${-x * 20}px, ${-y * 16}px)`
      })
  })

  // 大图加载失败 → 显示缺图占位
  trackEl.addEventListener('error', e => {
    if (e.target.tagName === 'IMG') {
      const slide = e.target.closest('.slide')
      if (slide) {
        e.target.style.visibility = 'hidden'
        slide.classList.add('no-photo')
      }
    }
  }, true)
}

export function initStage() {
  bus.on('photos:changed', buildSlides)
  bus.on('active:changed', ({ idx, fast }) => goTo(idx, { fast }))
  bus.on('view:changed', v => { if (v) showHint() })
  bindStageEvents()
}

/* ------------------------------------------------------------
 * 【预留接口】地图足迹组件 —— 供后续无缝接入 Leaflet / 高德地图
 *
 * @param {string}     location  地点名称（如 "青海湖"）
 * @param {HTMLElement} container 挂载容器（.map-slot 元素，含 data-location / data-coords）
 * @returns {Promise<{status: string, lnglat?: [number, number]}>}
 *
 * 接入 Leaflet 示例：
 *   1. npm i leaflet 并 import 'leaflet/dist/leaflet.css'
 *   2. container.innerHTML = '<div style="height:180px;border-radius:12px;overflow:hidden" id="leaflet-mini"></div>'
 *   3. 坐标已由 EXIF 提供（container.dataset.coords），无需地理编码：
 *      const { lat, lng } = JSON.parse(container.dataset.coords)
 *   4. L.map(el).setView([lat, lng], 11) + 瓦片图层 + 标记
 *   5. 在 goTo() 切页后调用：renderMapWidget(location, container)
 * ------------------------------------------------------------ */
export async function renderMapWidget(location, container) {
  if (!container) return { status: 'no-container' }
  return { status: 'not-implemented', location: location || '' }
}
