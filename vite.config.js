import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Vite 配置 —— PWA + Tauri 双通道构建：
 *
 * 【PWA】手机 Safari/Chrome 打开即安装；SW autoUpdate 静默升级；
 *        静态资源预缓存 + R2 照片运行时缓存（弱网/离线回看秒开）
 *
 * 【Tauri】Windows .exe：
 *   1. npm i -D @tauri-apps/cli
 *   2. 项目已内置 src-tauri/（tauri.conf.json + capabilities + icons + Rust 骨架）
 *   3. npm run build:desktop  →  产出 NSIS 安装包 / .exe
 *
 * 【浏览器端 R2 直传兼容性】（实测结论，2026-10）
 *   @aws-sdk/client-s3 v3 无需 Node polyfill（Buffer/process 未被引用），
 *   但 flexible-checksums 中间件要求流式 body，File/Blob 直传会报
 *   「readableStream.getReader is not a function」——
 *   已在 cloud.js 修复：Body 转 ArrayBuffer + requestChecksumCalculation:
 *   'WHEN_REQUIRED'，端到端 PUT 200 验证通过（SigV4 签名头齐全）。
 */
const host = process.env.TAURI_DEV_HOST
// 部署基路径：桌面端 / 本地 dev 用 '/'
// GitHub Pages 子路径部署时设置 VITE_BASE=/album_saver/（构建前 export）
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  clearScreen: false,
  server: {
    host: '0.0.0.0',        // 手机端局域网联调（手机相机直传的关键）
    port: 5173,
    strictPort: true,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] }
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Summer Memory Album',
        short_name: '夏日回忆',
        description: '暑假个人照片总结展映 · 多端实时协同相册',
        lang: 'zh-CN',
        theme_color: '#0B0D10',
        background_color: '#0B0D10',
        display: 'standalone',
        orientation: 'any',
        start_url: base === '/' ? '/' : base,
        scope: base === '/' ? '/' : base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // 云 SDK（supabase + aws-sdk，仅云模式按需动态加载）不进预缓存：
        // 本地模式免下载 500KB+，云模式在线使用时走网络
        globIgnores: ['**/vendorCloud-*.js'],
        // 离线基础缓存策略：应用壳（index.html）离线可达 + 静态资源版本化预缓存
        navigateFallback: base === '/' ? '/index.html' : `${base}index.html`,
        navigateFallbackDenylist: [/^\/assets\/vendorCloud-/],   // 云 SDK 不做离线回退（按需在线取）
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // 云端照片（R2 域名）CacheFirst：多端/离线回看加速
            urlPattern: ({ url }) => /\.(r2\.dev|cloudflarestorage\.com)$/.test(url.hostname) || /\/photos\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'r2-photos',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      devOptions: { enabled: true }   // dev 下也生成 SW，手机真机联调一致
    })
  ],
  build: {
    // es2020：@aws-sdk 使用 BigInt 字面量（CRC32），es2019 无法转译；覆盖 2021+ 全部主流浏览器
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'es2020',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    modulePreload: {
      // 云 SDK chunk 不注入 <link modulepreload>：仅被 cloud.js 动态 import，
      // 本地模式/首屏零下载，配置云后按需加载
      resolveDependencies(_filename, deps) {
        return deps.filter(d => !d.includes('vendorCloud'))
      }
    },
    rollupOptions: {
      output: {
        // 函数形式分包：数组形式会把 Rollup 公共 helper（preload-helper）
        // 卷进 vendorCloud，导致主包静态依赖云 SDK（首屏被迫加载 526KB）。
        // 函数形式下 helper 独立成微型 chunk，主包与云 chunk 各自引用。
        manualChunks(id) {
          if (id.includes('preload-helper')) return 'helpers'
          if (id.includes('node_modules/@supabase') || /node_modules[/\\]@aws-sdk/.test(id)) {
            return 'vendorCloud'
          }
          if (id.includes('node_modules/exifr') || id.includes('node_modules/html2canvas')) {
            return 'vendorImage'
          }
        }
      }
    }
  }
})
