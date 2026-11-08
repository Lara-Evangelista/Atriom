// Deliberately minimal: this desktop app is the same React/Vite web app
// (`../dist`, per tauri.conf.json's frontendDist), loaded into a native
// window. No Rust-side logic is needed unless you later want OS-level
// features (a tray icon, native file dialogs, etc.) — add them here as
// Tauri commands if that day comes.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the Chores desktop app");
}
