# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
./run.sh              # Start web dev server (localhost:5173)
./run.sh desktop      # Start Tauri desktop app + Vite dev server

# Frontend (from ui/)
pnpm dev              # Vite dev server
pnpm run build        # TypeScript check + production build
pnpm run lint         # ESLint

# Rust
cargo test --workspace          # Run all Rust tests
cargo build --workspace         # Build all crates

# WASM
wasm-pack build crates/mixboard-wasm --target web

# Desktop
pnpm run tauri:dev              # Tauri dev mode (from ui/)
pnpm run tauri:build            # Build macOS .dmg (from ui/)
```

## Architecture

**Dual-target app**: same React frontend runs as a web app (browser) or desktop app (Tauri v2 on macOS). A platform abstraction layer (`ui/src/platform/`) switches between Tauri IPC and browser APIs at runtime.

**Rust workspace** (`crates/`):
- `mixboard-core` — Shared domain models (elements, document, geometry, mindmap layout, history, serialization). Serde serializes to JSON for both WASM and Tauri IPC.
- `mixboard-tauri` — Tauri v2 app shell: IPC commands (`new_document`, `open_document`, `save_document`, `get_icloud_path`), native menus, plugin setup (dialog, fs).
- `mixboard-wasm` — Thin wasm-bindgen wrapper over core.

**Frontend** (`ui/src/`):
- `canvas/` — All canvas logic, separated by concern:
  - `Canvas.tsx` — Main component: event loop, keyboard shortcuts, tool dispatch (~2100 LOC)
  - `renderer.ts` — 2D canvas drawing for all element types
  - `interaction.ts` — Pointer event handling, drag, selection
  - `hit-test.ts` — Point-in-shape detection
  - `linear.ts` — Line/arrow connector math, endpoint snapping
  - `shape-utils.ts` — Shape variant path generation (56+ variants)
- `store/` — Zustand + Immer state:
  - `document.ts` — Element CRUD, undo/redo (100-entry stack), grouping, alignment, layer ordering
  - `ui.ts` — Active tool, selection, viewport, panel visibility, interaction flags
- `types/` — TypeScript element/document/tool type definitions
- `components/` — React UI (Toolbar, PropertyPanel, TopBar, ContextMenu, etc.)
- `platform/` — `getPlatform()` returns a `PlatformBridge` (Tauri or Web implementation)

**Data flow**: Zustand stores → React components → canvas events → store mutations. All state updates go through Immer for immutability.

## Key Conventions

- **Serde casing**: `BaseProperties` uses `#[serde(rename_all = "camelCase")]`; the `Element` enum uses individual `#[serde(rename)]` on multi-word variant fields
- **UUID**: Must use the `js` feature flag for WASM compatibility
- **Vite 8**: Use `minify: 'oxc'` (not `'esbuild'`)
- **Raw strings**: Content with `#` requires `r##"..."##` syntax
- **Linter auto-modifies files**: Always re-read files after linting before making edits
- **React 19** with TypeScript strict mode
