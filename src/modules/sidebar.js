/* ============================================================
 * sidebar.js · 展映模式左侧毛玻璃缩略图列表
 * ------------------------------------------------------------
 * - 垂直单列缩略图卡片（微缩图 + 地点 + 日期 + 关键标签）
 * - 列表内部独立平滑滚动（不与主舞台滚轮切页冲突）
 * - Hover 实时联动：mouseover 事件委托 → setActive(i, { fast: true })
 *   主画面以 .55s 短过渡无缝切换；goTo 幂等早退保证快速划过不卡顿
 * - 当前激活项：金色发光边框 + 指示点，键盘 Tab 聚焦同样联动
 * ============================================================ */
import { createIcons } from 'lucide'
import { iconRegistry } from './icons.js'
import { bus, state, setActive } from './state.js'

const listEl = document.getElementById('sb-list')
const countEl = document.getElementById('sb-count')

let itemEls = []   // 元素缓存：active 更新 O(1)

export function initSidebar() {
  bus.on('photos:changed', buildSidebar)
  bus.on('active:changed', ({ idx }) => updateActive(idx))

  // ★ Hover 实时联动切图（mouseover 委托：子元素间移动不重复触发）
  listEl.addEventListener('mouseover', e => {
    if (!state.presenting) return
    const item = e.target.closest('[data-i]')
    if (item) setActive(+item.dataset.i, { fast: true })
  })
  // 键盘 Tab 聚焦侧栏项时同样联动（无障碍）
  listEl.addEventListener('focusin', e => {
    if (!state.presenting) return
    const item = e.target.closest('[data-i]')
    if (item) setActive(+item.dataset.i)
  })
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function itemHTML(p, i) {
  const keyTags = [...p.tags, ...p.customTags].slice(0, 2)
  return `
  <button class="sb-item" data-i="${i}" type="button" title="${esc(p.location) || '未命名地点'}">
    <img class="sb-thumb" src="${esc(p.url)}" alt="" loading="lazy" ${p.url ? '' : 'data-missing'}>
    <span class="sb-info">
      <span class="sb-loc">${esc(p.location) || '未命名地点'}</span>
      <span class="sb-date">${esc(p.date) || '· · ·'}</span>
      ${keyTags.length ? `<span class="sb-tags">${keyTags.map(t => `<i class="sb-tag">${esc(t)}</i>`).join('')}</span>` : ''}
    </span>
    <span class="sb-dot" aria-hidden="true"></span>
  </button>`
}

function buildSidebar() {
  listEl.innerHTML = state.photos.map(itemHTML).join('')
  countEl.textContent = `共 ${state.photos.length} 张`
  itemEls = [...listEl.querySelectorAll('.sb-item')]
  createIcons({ icons: iconRegistry })
  updateActive(state.activeIdx)
}

function updateActive(idx) {
  itemEls.forEach(el => el.classList.toggle('on', +el.dataset.i === idx))
  itemEls[idx]?.scrollIntoView({ block: 'nearest' })   // 列表跟随（视口内则零动作）
}
