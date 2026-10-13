---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '510cf31a-fb18-46b8-9be7-511c4cecbcf4'
  PropagateID: '510cf31a-fb18-46b8-9be7-511c4cecbcf4'
  ReservedCode1: 'ed3fea47-ab44-4e49-ad56-f22eed713307'
  ReservedCode2: 'ed3fea47-ab44-4e49-ad56-f22eed713307'
---

# 夏日记忆 · Summer Memory Album

暑假个人照片总结展映 —— 支持手机/电脑多端实时协同的云原生相册。

- **手机端**：Safari / Chrome 直接打开即装为 PWA 应用，拍照/选图直传云端，无需原生 App
- **电脑端**：网页或 Tauri .exe，与手机端共享同一数据底座，任一端增删改照片/标签/文案，其他端 **WebSocket 实时无感更新**
- **零服务器成本**：全部依赖 Supabase 一个免费服务（PostgreSQL 元数据 + Storage 照片存储 1GB + Realtime 事件推送），**注册即用、无需绑卡**

> 未配置云服务时自动运行**纯本地模式**（图片存 IndexedDB、元数据存 localStorage），单机功能完整。

## 技术栈

Vite 5 + Tailwind CSS + 原生 JS（ES Modules）+ vite-plugin-pwa + @supabase/supabase-js（Storage 直传 + Realtime）+ exifr + html2canvas。

## 快速开始（纯本地模式，零配置）

```bash
npm install
npm run dev        # http://localhost:5173
```

## 云同步模式配置（约 5 分钟，只需 Supabase）

### 第 1 步 · Supabase 建库建桶（一条 SQL 搞定）

1. 打开 [supabase.com](https://supabase.com)，用 GitHub 账号登录（免费档，**无需绑卡**）→ **New project**
   - 名字随意（如 `summer-memory`），数据库密码点「Generate a password」自动生成，区域选 Singapore（离国内最近）
   - 等 1~2 分钟创建完成
2. 左侧 **SQL Editor** → New query → 把项目根目录的 **`supabase_schema.sql`** 全文粘贴进去 → 点 **Run**
   - 这一条脚本会同时完成：建 photos 表 + 开 RLS + 开 Realtime + **自动创建 photos 公开存储桶及其读写策略**
3. 左侧 **Settings → API**，复制两样东西（待会儿填入 .env.local）：
   - **Project URL**：形如 `https://xxxxx.supabase.co`
   - **anon public** 那个 key：`eyJ...` 一长串

### 第 2 步 · 填配置

```bash
cp .env.example .env.local   # 然后编辑 .env.local 填入 Project URL / anon key（桶名默认 photos 不用改）
npm run dev
```

头部徽章变为绿色 **「云同步」** 即配置成功；手机连同一 WiFi 访问 `http://局域网IP:5173`（vite 已监听 0.0.0.0）即可联调。

> 想核对桶是否建好：左侧 **Storage** 应能看到名为 `photos` 的桶，状态为 Public。

## 部署到公网（免费）

```bash
npm run build:web     # 产出 dist/
```

`dist/` 直接托管到 **Cloudflare Pages** 或 **Netlify**（均免费，直接上传 dist 文件夹即可，无需 git）：
手机 Safari 打开分配的网址 → 分享 → 添加到主屏幕，即完成 PWA 安装。

## Tauri 打包为 Windows .exe

项目已内置完整 `src-tauri/`（tauri.conf.json + capabilities + 图标 + Rust 骨架），无需 `tauri init`：

```bash
# 首次需 Rust 工具链（WebView2 与 MSVC 生成工具需已安装）
# 国内网络建议先配 rsproxy 镜像：见下方「验证清单」第 0 步
npm run build:desktop    # = tauri build → 产出 NSIS 安装包 / .exe
npm run dev:desktop      # = tauri dev → 桌面壳热重载调试
```

窗口规格：1280×800（最小 960×600）、无边框（`decorations: false`）+ 透明（`transparent: true`）——
标题栏由前端自绘（头部品牌区按住拖动窗口，右上角最小化/最大化/关闭按钮仅在桌面壳内显示，浏览器/PWA 零影响）。

## 构建与打包验证清单

### A. WSL2 下验证 Web 生产构建

```bash
# 0) （可选）进入项目目录（Windows 侧路径映射）
cd /mnt/c/Users/"William ethon"/Desktop/summer-memory-album

# 1) 安装依赖
npm ci                        # 或 npm install

# 2) 生产构建（零报错为通过）
npm run build:web             # 产出 dist/，含 manifest.webmanifest / sw.js / registerSW.js

# 3) 构建产物自检
ls -lh dist/assets/ | grep -E 'index|vendor|helpers'
#   预期：index-*.js ~50KB / vendorCloud-*.js ~525KB（仅云模式按需加载）/ helpers-*.js ~1KB
grep -c 'vendorCloud' dist/index.html          # 预期 0（不预加载云 SDK）
node -e "const s=require('fs').readFileSync('dist/sw.js','utf8');\
  const m=s.match(/precacheAndRoute\(\[([\s\S]*?)\]\)/);\
  console.log('sw预缓存含云SDK:', m?m[1].includes('vendorCloud'):'清单未解析')"
#   预期：false（云 SDK 不进离线预缓存；denylist 正则中出现 vendorCloud 字样属正常配置）
python3 -c "import json; m=json.load(open('dist/manifest.webmanifest')); \
  print(m['name'], m['short_name'], m['display'], m['background_color'], m['theme_color'])"
#   预期：Summer Memory Album 夏日回忆 standalone #0B0D10 #0B0D10

# 4) 本地预览冒烟
npm run preview -- --port 4173
#   浏览器打开 http://localhost:4173 → 头部徽章「本地模式」、照片卡片正常、
#   DevTools Console 0 errors、Application → Manifest 无警告即为通过
```

### B. Windows PowerShell 下验证 Tauri .exe 打包

```powershell
# 0) 一次性环境准备
#    a. 安装 Rust（rustup，选 stable-x86_64-pc-windows-msvc）：
#       访问 https://rustup.rs 下载 rustup-init.exe 后执行：
#       .\rustup-init.exe -y --default-toolchain stable-x86_64-pc-windows-msvc --profile minimal
#    b. （国内网络）配置 cargo 镜像加速，写入 %USERPROFILE%\.cargo\config.toml
#       （务必保存为 UTF-8 无 BOM，否则 cargo 报 "stream did not contain valid UTF-8"）：
#
#       [source.crates-io]
#       replace-with = 'rsproxy-sparse'
#       [source.rsproxy-sparse]
#       registry = "sparse+https://rsproxy.cn/index/"
#       [net]
#       git-fetch-with-cli = true
#
#    c. 确认工具链：npx tauri info   ← rustc/cargo/MSVC/WebView2 全部 ✔

# 1) 桌面端打包（首编约 5-15 分钟，400+ crates）
npm run build:desktop

# 2) 产物验收
Get-ChildItem src-tauri\target\release\bundle\nsis\    # NSIS 安装包 .exe
Get-ChildItem src-tauri\target\release\bundle\msi\     # MSI 安装包
Get-ChildItem src-tauri\target\release\ -Filter *.exe  # 绿色单文件 Summer Memories.exe

# 3) 安装包冒烟（或直接运行绿色 exe）
#    · 窗口 1280×800 打开、无系统标题栏（无边框设计）
#    · 按住头部「夏日记忆」区域可拖动窗口；右上角 ─ ▢ ✕ 三键工作正常
#    · 应用内照片/展映/导出功能与网页版一致；本地模式徽章正常
#    · 若已配置 .env.local（云模式），Supabase 请求可正常发出（CSP 放行 https:/wss:）
```

### C. 已知坑位速查

| 症状 | 原因与解法 |
| --- | --- |
| `tauri` feature `transparent` 不存在 | Tauri v2 移除该 feature（v1 遗留）；窗口透明直接用 `transparent: true` 配置项 |
| cargo 报 `stream did not contain valid UTF-8` | `.cargo/config.toml` 被 PowerShell 写成 UTF-16；用 UTF-8 无 BOM 重写 |
| `Updating crates.io index` 卡住 | 官方源被墙；按上面第 0 步配置 rsproxy 镜像 |
| 打 MSI 时卡在下载 wix314-binaries.zip | WiX 走 GitHub 直连，国内网络慢；targets 已默认只留 `nsis`（如确需 MSI，挂代理或手动下载后放入 `%LOCALAPPDATA%\tauri\WixTools`） |
| 前端构建报 BigInt 错误 | build.target 已设 `es2020`，勿改回 es2019 |

## 架构与数据流

```
手机PWA ──┐                                   ┌── 电脑网页
          ├─ WebSocket (Supabase Realtime) ──┤
Tauri端 ──┘          ▲                        └── 其他任何浏览器
                     │ INSERT/UPDATE/DELETE 事件推送
                     │
     ┌───────────────┴───────────────┐
     │  Supabase PostgreSQL（元数据）  │
     │  photos 表 + Realtime 发布      │
     └───────────────┬───────────────┘
                     │ image_url / storage_path
     ┌───────────────▼───────────────┐
     │  Supabase Storage（照片原图）   │
     │  photos 公开桶（免费 1GB）      │
     └───────────────────────────────┘
```

- **上传链路**：客户端 exifr 解析 EXIF（拍摄时间/GPS）→ Storage API 直传原图（REST fetch，无浏览器兼容坑）→ INSERT 元数据 → Realtime 推送所有在线端
- **编辑链路**：本地乐观更新（optimistic）→ UPDATE Supabase → 其他端实时合并；自己的回声事件自动去重
- **模块划分**：`cloud.js`（云通道）· `state.js`（数据中心+事件总线）· `sidebar.js` / `stage.js`（展映视图）· `export.js`（海报/JSON）· `exif.js`
- supabase-js **动态 import**，纯本地模式不加载、首屏零负担

## ⚠️ 安全须知

当前 schema 对 anon key 全开放（个人相册、零成本取舍）。anon key 会出现在前端产物中，**任何人拿到链接即可读写你的相册**。适用边界：

- ✅ 个人自用 / 家庭共享 / 演示答辩
- ⚠️ 公网长期部署请自行收紧：Supabase 换 email 登录 + RLS 按用户隔离

## 数据备份

任一端「JSON」按钮可导出全部元数据与图片数据（本地模式含图片 base64；云模式含 Storage 地址），导入即恢复，与云数据互不冲突。

> AI生成