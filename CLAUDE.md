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

# Desktop
pnpm run tauri:dev              # Tauri dev mode (from ui/)
pnpm run tauri:build            # Build macOS .dmg (from ui/)
```

## Architecture

**Dual-target app**: same React frontend runs as a web app (browser) or desktop app (Tauri v2 on macOS). A platform abstraction layer (`ui/src/platform/`) switches between Tauri IPC and browser APIs at runtime.

**Rust workspace** (`crates/`):
- `mixnote-tauri` — the only crate: Tauri v2 app shell. IPC commands for the vault (资料库: a user-chosen folder of `.mixnote` boards, anywhere incl. iCloud Drive — see `src/vault.rs`: listing, create/rename/trash, iCloud download of evicted files, and `read_document`/`write_document`, which write atomically and keep another Mac's concurrent edits as a sibling copy) and quit-time autosave flush, native menus and plugin setup (dialog, fs). The `.mixnote` file format (version check, defensive element loading) lives in `ui/src/utils/board-format.ts`. The domain model (elements, document, geometry, mindmap layout, history, serialization) lives entirely in TypeScript under `ui/src/` — there is no Rust core or WASM build. The AI assistant feature was removed.

> Note: the old `mixboard-core` and `mixboard-wasm` crates were removed (dead code — the UI never imported them and their logic was reimplemented in TS). Don't reintroduce a Rust core unless there's a concrete need (native perf for large-doc layout, or a non-Tauri browser build reusing one model).

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
