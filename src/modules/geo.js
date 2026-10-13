/* ============================================================
 * geo.js · GPS 坐标 → 具体地名（逆地理编码）
 * ------------------------------------------------------------
 * 照片 EXIF 带 GPS（WGS84）但 location 为空时，自动调用
 * OpenStreetMap Nominatim 免费公开 API 把坐标转成
 * 「XX省 · XX市」写入地点字段（云端同步 + 多端实时联动）。
 *
 * - Nominatim：免 key、免费，限速 1 次/秒（代码已节流）
 * - EXIF 坐标是 WGS84，Nominatim 同为 WGS84，无国测局偏移问题
 * - 失败（无网/超时/无结果）保持地点为空，不打扰用户
 * - tried 集合防止同一张照片反复请求（含失败）
 * ============================================================ */
import { state, updatePhoto } from './state.js'

const tried = new Set()   // 已尝试过逆地理的照片 id（成功或失败均不再重试）

/**
 * 逆地理编码：坐标 → 「XX省 · XX市」
 * @returns {Promise<string>} 失败返回 ''
 */
export async function reverseGeocode({ lat, lng }) {
  const url = `https://nominatim.openstreetmap.org/reverse` +
    `?lat=${lat}&lon=${lng}&format=jsonv2&accept-language=zh-CN&zoom=10`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return ''
    const j = await res.json()
    const a = j.address || {}
    const province = a.state || a.province || ''
    const city = a.city || a.city_district || a.prefecture || a.county || a.municipality || ''
    const parts = [province, city].filter(Boolean)
    if (parts.length) return parts.join(' · ')
    return j.name || j.display_name?.split(',').slice(0, 2).join(' · ') || ''
  } catch {
    return ''                       // 超时/无网：静默，地点保持空
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 自动补全：扫描所有「有 GPS 且地点为空」的照片并逐个逆地理。
 * 幂等可反复调用（新增照片后再次触发只处理增量）。
 * fire-and-forget：调用方无需 await。
 */
export async function autoFillLocations() {
  const targets = state.photos.filter(p => p?.coords && !p.location && !tried.has(p.id))
  if (!targets.length) return
  for (const p of targets) {
    tried.add(p.id)
    const loc = await reverseGeocode(p.coords)
    if (loc) {
      try { updatePhoto(p.id, { location: loc }) } catch { /* 并发删除等，忽略 */ }
    }
    await new Promise(r => setTimeout(r, 1200))   // Nominatim 限速 1 次/秒，节流
  }
}