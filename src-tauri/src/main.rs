// Summer Memories · Tauri 壳入口
// windows_subsystem：发布版隐藏控制台窗口（Windows 桌面应用标准做法）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    summer_memory_lib::run()
}
