/* ============================================================
 * tauri-titlebar.js · Tauri 无边框窗口自绘标题栏控制
 * ------------------------------------------------------------
 * 配套 tauri.conf.json 的 decorations:false + transparent:true：
 *   - 头部 .brand 区域已带 data-tauri-drag-region（按住拖动窗口）
 *   - 右上角窗口控制按钮（最小化/最大化/关闭）仅在 Tauri 壳内显示
 *   - 浏览器 / PWA 环境完全隐藏，零副作用（不依赖 @tauri-apps/api，
 *     通过 withGlobalTauri 暴露的 window.__TAURI__ 动态探测）
 * ============================================================ */

import { createIcons } from 'lucide'
import { iconRegistry } from './icons.js'

export function initTauriTitlebar() {
  // Tauri v2 注入 window.__TAURI__（需 withGlobalTauri: true）；
  // 浏览器无此对象 → 直接返回，按钮保持 hidden
  const tauri = window.__TAURI__
  if (!tauri?.window?.getCurrentWindow) return false

  let appWindow
  try {
    appWindow = tauri.window.getCurrentWindow()
  } catch (err) {
    console.warn('[tauri-titlebar] 获取窗口句柄失败', err)
    return false
  }

  const controls = document.getElementById('tauri-window-controls')
  const btnMin = document.getElementById('tauri-minimize')
  const btnMax = document.getElementById('tauri-maximize')
  const btnClose = document.getElementById('tauri-close')
  if (!controls || !btnMin || !btnMax || !btnClose) return false

  // 最大化 ↔ 还原图标与提示随窗口状态切换（square=最大化，copy=还原）
  const setMaxIcon = (isMax) => {
    const ic = btnMax.querySelector('[data-lucide]')
    if (ic) {
      ic.setAttribute('data-lucide', isMax ? 'copy' : 'square')
      btnMax.title = isMax ? '还原' : '最大化'
      createIcons({ icons: iconRegistry })
    }
  }
  const syncMax = () => appWindow.isMaximized().then(setMaxIcon).catch(() => {})

  btnMin.addEventListener('click', () => appWindow.minimize().catch(() => {}))
  btnMax.addEventListener('click', () => appWindow.toggleMaximize().catch(() => {}))
  btnClose.addEventListener('click', () => appWindow.close().catch(() => {}))

  // 窗口尺寸变化（含双击拖拽区最大化/还原）后同步按钮图标
  appWindow.onResized(() => syncMax())
  syncMax()

  controls.hidden = false
  document.body.classList.add('in-tauri')   // 供 CSS 做壳内微调（如内边距/圆角）
  return true
}
