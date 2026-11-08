# Desktop app (Tauri)

This wraps the exact same React/Vite web app (`../dist`) as a native
desktop window — no separate frontend to maintain. Nothing in `src/`
needs to change for this to work.

## One-time setup (per machine you build on)

Tauri needs a Rust toolchain, which this project's own sandbox doesn't
have — you'll run these steps on your own machine:

1. Install Rust: https://www.rust-lang.org/tools/install
2. Install the OS-level dependencies Tauri needs for your platform:
   https://v2.tauri.app/start/prerequisites/ (on Linux this is a handful
   of system packages; on Windows it's the "Desktop development with
   C++" workload; on macOS it's just Xcode command line tools).
3. From `frontend/`:
   ```
   npm install
   ```

## Generate real app icons

The icons in `src-tauri/icons/` are plain placeholders (a solid square
with "C" — see `icon-source-1024.png`). Swap that source file for your
own 1024×1024 PNG, then regenerate the full icon set (adds the
platform-specific `.ico`/`.icns` files this placeholder set doesn't
include):

```
npx tauri icon src-tauri/icons/icon-source-1024.png
```

## Run / build

```
npm run tauri dev      # opens a native window against the Vite dev server
npm run tauri build    # produces an installer/binary under src-tauri/target/release/bundle
```

`beforeDevCommand`/`beforeBuildCommand` in `tauri.conf.json` already run
`npm run dev` / `npm run build` for you, so you don't need to build the
web app separately first.

## Notes

- Environment variables: the desktop build reads `.env` at build time,
  same as the web build (Vite bakes `VITE_*` vars into the bundle) — so
  set up `.env` before running `npm run tauri build`.
- Push notifications: Tauri v2 windows are Chromium/WebKit-based and do
  support the same Web Push code path used on the web (`src/lib/push.js`),
  but OS notification permissioning varies by platform — test this on
  each OS you ship to before relying on it.
- If you'd rather ship to the Play Store / App Store instead of (or in
  addition to) a desktop binary, Capacitor wraps this same web app for
  that — a smaller step than Tauri, not covered here yet.
