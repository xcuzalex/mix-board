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
  setSelectedMindmapNode: (node: { elementId: string; nodeId: string } | null) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;

  // Viewport
  viewportX: number;
  viewportY: number;
  zoom: number;
  targetZoom: number;
  setViewport: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
  setTargetZoom: (zoom: number) => void;
  panBy: (dx: number, dy: number) => void;

  // UI panels
  showPropertyPanel: boolean;
  showGrid: boolean;
  /** Dot-grid canvas backdrop (remembered per device). */
  showDots: boolean;
  showOutline: boolean;
  setShowPropertyPanel: (show: boolean) => void;
  toggleGrid: () => void;
  toggleDots: () => void;
  toggleOutline: () => void;
  setShowOutline: (show: boolean) => void;

  // Interaction state
  isDrawing: boolean;
  isDragging: boolean;
  isPanning: boolean;
  setIsDrawing: (v: boolean) => void;
  setIsDragging: (v: boolean) => void;
  setIsPanning: (v: boolean) => void;

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
  addToSelection: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds
        : [...state.selectedIds, id],
    })),
  removeFromSelection: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.filter((sid) => sid !== id),
    })),
  clearSelection: () => set({ selectedIds: [] }),

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
  panBy: (dx, dy) =>
    set((state) => ({
      viewportX: state.viewportX + dx,
      viewportY: state.viewportY + dy,
    })),

  showPropertyPanel: false,
  showGrid: false,
  showDots: loadStoredDots(),
  showOutline: false,
  setShowPropertyPanel: (show) => set({ showPropertyPanel: show }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleDots: () => set((state) => {
    storeDots(!state.showDots);
    return { showDots: !state.showDots };
  }),
  toggleOutline: () => set((state) => ({ showOutline: !state.showOutline })),
  setShowOutline: (show) => set({ showOutline: show }),

  isDrawing: false,
  isDragging: false,
  isPanning: false,
  setIsDrawing: (v) => set({ isDrawing: v }),
  setIsDragging: (v) => set({ isDragging: v }),
  setIsPanning: (v) => set({ isPanning: v }),

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
