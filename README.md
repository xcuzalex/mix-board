# MixNote

A knowledge-notes app on an infinite canvas, in the spirit of Apple Freeform: Markdown note cards, tables, kanbans, 2×2 matrices, mindmaps and diagrams side by side. Boards live as `.mixnote` files in a folder you choose (your *library*, optionally in iCloud Drive) and save automatically. Runs as a native macOS desktop app (Tauri v2) or a static web app.

## Features

### Canvas & Interaction
- Pan, zoom (0.1×–5×), grid toggle, snap guides
- Box selection, multi-select (Shift+click)
- Undo/redo (100-step history)
- Copy / paste / duplicate with offset
- Group and ungroup elements
- Layer ordering (bring to front/back)
- Align and distribute elements
- Context menu (right-click)

### Notes & Markdown
- Note cards, sticky notes and text render Markdown: headings, **bold**, *italic*, `code`, lists, quotes
- `[ ]` / `[x]` todos — click a checkbox to tick it, anywhere (notes, table cells, kanban cards, matrix quadrants)
- Enter continues a list or todo list (next bullet, unchecked todo, next number); Enter on an empty item ends it
- `[[Note title]]` links between notes, with suggestions while typing; click a link to jump to the note
- Outline sidebar and Markdown export of a whole board

### Structured Blocks
Inserted from the toolbar's 表格与结构 menu:
- **Table** — Markdown cells, header row, Tab / Shift+Tab between cells; grips beside the table to select, insert or delete rows and columns, ＋ bars to append
- **Kanban** — columns of cards, drag cards between columns; ⋯ on a column header to insert or delete columns (cards move to the neighbour), ＋ bar to append
- **2×2 matrix** — priority / SWOT / effort presets; write straight into each quadrant (lists and todos supported); notes dropped on it move with it
- **Code block** — syntax highlighting for common languages, dark / light theme

### Library (Vault) & iCloud — desktop
- Pick any folder as your library, or iCloud Drive (`iCloud 云盘/MixNote` or any folder inside iCloud Drive); boards are plain `.mixnote` files you can see in Finder
- Autosave: every board is saved to its file as you work (atomically, so a crash never leaves a half-written file); unsaved work is also kept as a local draft
- Library page with previews, folders, favourites and search
- **Multiple Macs:** if a board was changed on another Mac while you edited it here, that version is kept beside yours as `<name>（另一台设备的版本）.mixnote` — nothing is overwritten. An open board without local edits reloads automatically when another Mac changes it
- Boards iCloud hasn't downloaded to this Mac yet are fetched automatically; opening one waits for it
- Files from a newer MixNote version are refused rather than silently downgraded

### Clipboard
- Paste screenshots and images straight onto the canvas (large images are scaled to ≤ 2048 px and re-encoded to keep files small)
- Paste text as a note card (Markdown kept); text copied from spreadsheets / documents pastes as text, not as a picture
- Copied elements paste as elements, and their text goes to the system clipboard for other apps

### Element Types
| Type | Description |
|------|-------------|
| Shape | Rectangle, ellipse, diamond, triangle — with text, fill, and stroke |
| Text | Standalone text block |
| Sticky Note | Colored notes (9 colors) |
| Line / Arrow | Connectors with 11 arrow-head styles and 4 connector shapes |
| Freehand | Pressure-sensitive pen drawing |
| Highlighter | Semi-transparent brush |
| Image | Embedded images — file pick or paste (shown at ≤ 400 px, stored at ≤ 2048 px) |
| Mindmap | Tree diagrams with 7 layout modes |
| Table | Grid table with Markdown cells and on-board row / column controls |
| Kanban | Columns of cards, drag between columns |
| 2×2 Matrix | Titled quadrants with axis labels and per-quadrant notes |
| Code | Code card with syntax highlighting |
| Section | Labeled container for organizing elements |
| Frame | Export-ready frame container |

### Extended Shape Library (35+ variants)
In the drawing flyout: search, ★ favourites (shown first) and recently used shapes; grouped as Basic, Flowchart, and UML & Architecture.

Pill, hexagon, octagon, parallelogram, trapezoid, star, speech bubble, cloud, cylinder, database, document, flowchart symbols (process, predefined process, manual input, display, delay, internal storage), UML (class box, package, component), state machine, and more.

### Connectors & Lines
- Connector shapes: straight, polyline, curve, right-angled polyline
- Arrow heads (per endpoint): none, arrow, open arrow, hollow arrow, diamond, hollow diamond, circle, hollow circle, bar, triangle, hollow triangle
- Snap-to-connection-points on shapes (4 points per shape)

### Mindmap
- 7 layout modes: left-right, left-only, right-only, top-down tree, right-flowing tree, org chart, timeline
- Node shapes: text, rounded rect, pill
- Node colors, font size, collapse/expand
- Keyboard-driven: Tab (add child), Enter (add sibling)

### File Operations
- Desktop: boards autosave into the library; open other `.mixnote` files with ⌘O (they stay saveable after a restart)
- Web: drafts in the browser (IndexedDB), download / upload `.mixnote` files
- Export a board as PNG (with 40px padding) or as Markdown

## Keyboard Shortcuts

### Tools
| Key | Tool |
|-----|------|
| `V` | Select |
| `H` | Hand (pan) |
| `R` | Rectangle |
| `O` | Ellipse |
| `D` | Diamond |
| `L` | Line |
| `A` | Arrow |
| `T` | Text |
| `N` | Sticky note |
| `P` | Freehand pen |
| `Shift+P` | Highlighter |
| `I` | Image |
| `M` | Mindmap |
| `F` | Frame |
| `Shift+S` | Section |

### Editing
| Key | Action |
|-----|--------|
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` | Redo |
| `Ctrl/Cmd+A` | Select all |
| `Ctrl/Cmd+C` | Copy |
| `Ctrl/Cmd+V` | Paste |
| `Ctrl/Cmd+D` | Duplicate |
| `Ctrl/Cmd+G` | Group |
| `Ctrl/Cmd+Shift+G` | Ungroup |
| `Delete` / `Backspace` | Delete selected |
| `Ctrl/Cmd+S` | Save |
| `Ctrl/Cmd+Shift+E` | Export PNG |

### Layer Ordering
| Key | Action |
|-----|--------|
| `Ctrl/Cmd+]` | Bring forward |
| `Ctrl/Cmd+Shift+]` | Bring to front |
| `Ctrl/Cmd+[` | Send backward |
| `Ctrl/Cmd+Shift+[` | Send to back |

### Canvas
| Key | Action |
|-----|--------|
| `Space` (hold) | Pan mode |
| `Shift+G` | Toggle grid |
| `Ctrl/Cmd+Scroll` | Zoom |
| `Esc` | Deselect / exit editing |

### Mindmap
| Key | Action |
|-----|--------|
| `Tab` | Add child node |
| `Enter` | Add sibling node |
| Double-click | Edit node text |

### Notes & Blocks
| Key | Action |
|-----|--------|
| `Enter` (in a list item) | Continue the list / todo list |
| `Tab` / `Shift+Tab` (table cell) | Next / previous cell |
| `Enter` (cell, card, label) | Finish editing (`Shift+Enter` for a new line) |
| `Cmd+Enter` / `Esc` (matrix quadrant, code) | Finish editing |
| `Delete` (selected table row / column) | Delete that row / column |
| `[[` | Link to another note |

## Getting Started

### Prerequisites

**Web:**
- Node.js 20+, npm 10+

**Desktop (macOS):**
- Node.js 20+, npm 10+
- Rust stable + Cargo
- Xcode Command Line Tools: `xcode-select --install`

Install Rust:
```bash
curl https://sh.rustup.rs -sSf | sh
rustup default stable
```

### Quick Start

```bash
./run.sh            # Web — opens at http://localhost:5173
./run.sh desktop    # macOS desktop app
./run.sh --help     # Show usage
```

The script auto-installs npm dependencies on first run.

### Manual Setup

```bash
# Web only
cd ui && npm install && npm run dev

# Desktop
cd ui && npm install && npm run tauri:dev
```

## Building

```bash
# Frontend (outputs to ui/dist)
cd ui && npm run build

# macOS .dmg
cd ui && npm run tauri:build
```

## Document Format

Files use the `.mixnote` extension (JSON):

```json
{
  "type": "mixnote",
  "version": 1,
  "source": "MixNote/0.1.0",
  "elements": [...],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "gridEnabled": false,
    "gridSize": 20
  },
  "files": {}
}
```

`files` stores embedded images as base64 data URLs (only those still on the board).

- `version` is the format version. A file with a higher version than the app knows is refused (upgrade MixNote) instead of being opened and saved back in an older format.
- Loading is defensive: structured blocks with missing fields are repaired, broken lines / mindmaps are skipped, oversized tables are capped — one bad element can't break a board.
- Legacy `.mixboard` files (type `"mixboard"`) from before the rename still open.
- In a library, `.mixnote/favorites.json` holds the starred boards; conflict copies from other Macs are ordinary boards named `…（另一台设备的版本）`.

## Project Structure

```
mix-board/
├── Cargo.toml                   # Rust workspace
├── run.sh                       # One-command startup
├── crates/
│   └── mixnote-tauri/           # Tauri shell: vault (library) commands, atomic file IO, iCloud
└── ui/
    └── src/
        ├── canvas/              # Renderer, interaction, hit-test, connectors
        ├── components/          # Toolbar, PropertyPanel, TopBar, ContextMenu
        ├── platform/            # Desktop/web abstraction layer
        ├── store/               # Zustand state (document + UI)
        ├── types/               # TypeScript element/document/tool types
        └── utils/               # File format, autosave, vault, export, thumbnails
```

**Stack:** React 19, TypeScript 5, Vite 8, Zustand + Immer, Tailwind CSS 4, Tauri v2.

## Troubleshooting

**`./run.sh: Permission denied`**
```bash
chmod +x run.sh
```

**Tauri: missing Rust or system deps**
```bash
rustc --version && cargo --version
xcode-select --install   # macOS
```

**Port 5173 in use** — Vite will report the conflict. Kill the occupying process or change the port in `ui/vite.config.ts`.
