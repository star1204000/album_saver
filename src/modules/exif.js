/* ============================================================
 * exif.js · 基于 exifr 的照片元数据提取
 * ------------------------------------------------------------
 * 从原始文件（未经 canvas 压缩，保留完整 EXIF 段）提取：
 *   - 拍摄日期：DateTimeOriginal → CreateDate → ModifyDate 依次回退
 *   - GPS 经纬度：exifr.gps() 直接输出十进制 lat/lng
 * 解析失败静默降级（返回 null），不阻断上传流程。
 * ============================================================ */
import exifr from 'exifr'

const pad2 = n => String(n).padStart(2, '0')
const fmt = d => `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`

/**
 * 提取拍摄日期与 GPS 坐标
 * @param {File} file 原始图片文件
 * @returns {Promise<{date: string|null, coords: {lat:number,lng:number}|null}>}
 */
export async function extractMeta(file) {
  const out = { date: null, coords: null }
  try {
    const [dates, gps] = await Promise.all([
      exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] }).catch(() => null),
      exifr.gps(file).catch(() => null)
    ])
    const raw = dates?.DateTimeOriginal || dates?.CreateDate || dates?.ModifyDate
    if (raw instanceof Date && !isNaN(raw.getTime())) out.date = fmt(raw)
    if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number'
      && isFinite(gps.latitude) && isFinite(gps.longitude)) {
      out.coords = { lat: +gps.latitude.toFixed(5), lng: +gps.longitude.toFixed(5) }
    }
  } catch (err) {
    console.warn('EXIF 读取失败', err)
  }
  return out
}

/** 坐标格式化为人类可读度分格式（展映卡片展示用） */
export function formatCoords(coords) {
  if (!coords) return ''
  const f = (v, pos, neg) => `${Math.abs(v).toFixed(3)}°${v >= 0 ? pos : neg}`
  return `${f(coords.lat, 'N', 'S')}, ${f(coords.lng, 'E', 'W')}`
}
