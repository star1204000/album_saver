// Summer Memories · Tauri 应用装配
// 前端为纯静态 SPA（../dist），无自定义 Rust 命令；
// 云同步（Supabase Realtime / R2 直传）全部由 WebView 内 fetch/WebSocket 完成，
// 网络访问由 tauri.conf.json 的 CSP connect-src 放行（https: / wss:）。

use std::path::PathBuf;

/// WebView2 用户数据目录：照片数据库（IndexedDB）、缓存等全部落在 D:\album\data。
/// 该目录不存在时自动创建；创建失败（如 D 盘不可用）则回退系统默认位置，应用仍可正常运行。
const DATA_DIR: &str = r"D:\album\data";

fn ensure_webview_data_dir() {
    let dir = PathBuf::from(DATA_DIR);
    if !dir.exists() {
        if let Err(err) = std::fs::create_dir_all(&dir) {
            eprintln!("[summer-memories] 数据目录创建失败，使用系统默认位置: {err}");
            return; // 回退：不设环境变量，WebView2 用默认目录
        }
    }
    // WebView2 Loader 读取本进程环境变量决定数据落盘位置
    // safety: 单线程初始化阶段调用，无并发竞争
    unsafe {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &dir);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ensure_webview_data_dir();
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Summer Memories");
}
