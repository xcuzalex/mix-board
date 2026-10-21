# MixNote

An infinite canvas / whiteboard application. Runs as a static web app or a native macOS desktop app (Tauri v2).

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

### Element Types
| Type | Description |
|------|-------------|
| Shape | Rectangle, ellipse, diamond, triangle — with text, fill, and stroke |
| Text | Standalone text block |
| Sticky Note | Colored notes (9 colors) |
| Line / Arrow | Connectors with 11 arrow-head styles and 4 connector shapes |
| Freehand | Pressure-sensitive pen drawing |
| Highlighter | Semi-transparent brush |
| Image | Embedded images (auto-scaled to 400px) |
| Mindmap | Tree diagrams with 7 layout modes |
| Table | Grid table with cell editing |
| Section | Labeled container for organizing elements |
| Frame | Export-ready frame container |

### Extended Shape Library (35+ variants)
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
- Save / open `.mixnote` files (JSON format)
- Export canvas as PNG (with 40px padding)
- Desktop: native file dialogs, direct filesystem access
- Web: file picker input, blob download

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

`files` stores embedded assets (images) as base64.

## Project Structure

```
mix-board/
├── Cargo.toml                   # Rust workspace
├── run.sh                       # One-command startup
├── crates/
│   └── mixnote-tauri/           # Tauri desktop shell + IPC commands
└── ui/
    └── src/
        ├── canvas/              # Renderer, interaction, hit-test, connectors
        ├── components/          # Toolbar, PropertyPanel, TopBar, ContextMenu
        ├── platform/            # Desktop/web abstraction layer
        ├── store/               # Zustand state (document + UI)
        ├── types/               # TypeScript element/document/tool types
        └── utils/               # IO, color, math, ID helpers
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
