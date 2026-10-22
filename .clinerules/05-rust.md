---
paths:
  - "src-tauri/**"
---
# Tauri / Rust Guidelines

- Keep the Rust crate name (`Cargo.toml` `[package] name`), lib name (`[lib] name`), and `main.rs` call (`<lib>_lib::run()`) in sync.
- When adding a Tauri plugin, register it in `src-tauri/src/lib.rs`, declare permissions in `src-tauri/capabilities/*.json`, and expose it in `modules/tauri.ts`.
- Keep `tauri.conf.json` `productName`, `identifier`, and window `title` consistent with the project name.
- Follow Rust edition 2024 and existing formatting; run `cargo build` in `src-tauri` to validate Rust changes.
