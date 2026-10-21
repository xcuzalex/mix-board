import { create } from 'zustand';
import type { ToolType } from '../types/tool';
import type { ShapeVariant } from '../types/element';
import {
  type Theme,
  type EffectiveTheme,
  applyTheme,
  loadStoredTheme,
  storeTheme,
} from '../theme';

interface UIStore {
  // Tool state
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  activeShapeVariant: ShapeVariant;
  setActiveShapeVariant: (variant: ShapeVariant) => void;

  // Drawing colors
  freedrawColor: string;
  highlighterColor: string;
  setFreedrawColor: (color: string) => void;
  setHighlighterColor: (color: string) => void;

  // Selection
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  selectedMindmapNode: { elementId: string; nodeId: string } | null;
  /** Last table cell the user edited or clicked (target of row/column actions). */
  tableCursor: { elementId: string; row: number; col: number } | null;
  setTableCursor: (cursor: { elementId: string; row: number; col: number } | null) => void;
  setSelectedMindmapNode: (node: { elementId: string; nodeId: string } | null) => void;

  // Viewport
  viewportX: number;
  viewportY: number;
  zoom: number;
  targetZoom: number;
  setViewport: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
  setTargetZoom: (zoom: number) => void;

  // UI panels
  showGrid: boolean;
  /** Dot-grid canvas backdrop (remembered per device). */
  showDots: boolean;
  showOutline: boolean;
  toggleGrid: () => void;
  toggleDots: () => void;
  toggleOutline: () => void;


  // Cursor
  cursorStyle: string;
  setCursorStyle: (style: string) => void;

  // Theme (light / dark / system)
  theme: Theme;
  effectiveTheme: EffectiveTheme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
}

// Pre-rename key, kept so the saved preference survives.
const DOTS_STORAGE_KEY = 'mixboard.canvas.dots';

function loadStoredDots() {
  try {
    return localStorage.getItem(DOTS_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function storeDots(show: boolean) {
  try {
    localStorage.setItem(DOTS_STORAGE_KEY, show ? '1' : '0');
  } catch {
    // A per-device preference; ignore storage failures.
  }
}

const initialTheme = loadStoredTheme();
const initialEffectiveTheme = applyTheme(initialTheme);

export const useUIStore = create<UIStore>()((set, get) => ({
  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool }),
  activeShapeVariant: 'round_rectangle',
  setActiveShapeVariant: (variant) => set({ activeShapeVariant: variant }),

  freedrawColor: '#1B1B1F',
  highlighterColor: 'rgba(255, 235, 59, 0.4)',
  setFreedrawColor: (color) => set({ freedrawColor: color }),
  setHighlighterColor: (color) => set({ highlighterColor: color }),

  selectedIds: [],
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  selectedMindmapNode: null,
  setSelectedMindmapNode: (node) => set({ selectedMindmapNode: node }),
  tableCursor: null,
  setTableCursor: (cursor) => set({ tableCursor: cursor }),

  viewportX: 0,
  viewportY: 0,
  zoom: 1,
  targetZoom: 1,
  setViewport: (x, y) => set({ viewportX: x, viewportY: y }),
  setZoom: (zoom) => {
    const clamped = Math.max(0.1, Math.min(5, zoom));
    set({ zoom: clamped, targetZoom: clamped });
  },
  setTargetZoom: (zoom) => set({ targetZoom: Math.max(0.1, Math.min(5, zoom)) }),

  showGrid: false,
  showDots: loadStoredDots(),
  showOutline: false,
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleDots: () => set((state) => {
    storeDots(!state.showDots);
    return { showDots: !state.showDots };
  }),
  toggleOutline: () => set((state) => ({ showOutline: !state.showOutline })),


  cursorStyle: 'default',
  setCursorStyle: (style) => set({ cursorStyle: style }),

  theme: initialTheme,
  effectiveTheme: initialEffectiveTheme,
  setTheme: (theme) => {
    storeTheme(theme);
    const effectiveTheme = applyTheme(theme);
    set({ theme, effectiveTheme });
  },
  cycleTheme: () => {
    const order: Theme[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(get().theme) + 1) % order.length];
    get().setTheme(next);
  },
}));

// --- Viewport helpers (read the store at call time; no React subscription) ---

function canvasViewSize() {
  const rect = document.querySelector('canvas')?.getBoundingClientRect();
  return { width: rect?.width ?? window.innerWidth, height: rect?.height ?? window.innerHeight };
}

/** Canvas-space point at the centre of the visible canvas. */
export function getViewportCenter() {
  const { viewportX, viewportY, zoom } = useUIStore.getState();
  const { width, height } = canvasViewSize();
  return { x: (width / 2 - viewportX) / zoom, y: (height / 2 - viewportY) / zoom };
}

/** Zooms to `nextZoom`, keeping the centre of the view where it is. */
export function zoomAroundCenter(nextZoom: number) {
  const { viewportX, viewportY, zoom, setViewport, setZoom } = useUIStore.getState();
  const z = Math.max(0.1, Math.min(5, nextZoom));
  const { width, height } = canvasViewSize();
  const cx = width / 2;
  const cy = height / 2;
  setViewport(cx - ((cx - viewportX) * z) / zoom, cy - ((cy - viewportY) * z) / zoom);
  setZoom(z);
}

/** Pans so canvas point (x, y) is centred, optionally at a new zoom. */
export function centerViewOn(x: number, y: number, nextZoom?: number) {
  const { zoom, setViewport, setZoom } = useUIStore.getState();
  const z = nextZoom === undefined ? zoom : Math.max(0.1, Math.min(5, nextZoom));
  const { width, height } = canvasViewSize();
  if (z !== zoom) setZoom(z);
  setViewport(width / 2 - x * z, height / 2 - y * z);
}
