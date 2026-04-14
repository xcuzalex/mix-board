import { create } from 'zustand';
import type { ToolType } from '../types/tool';
import type { ShapeVariant } from '../types/element';

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
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;

  // Viewport
  viewportX: number;
  viewportY: number;
  zoom: number;
  setViewport: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
  panBy: (dx: number, dy: number) => void;

  // UI panels
  showPropertyPanel: boolean;
  showGrid: boolean;
  setShowPropertyPanel: (show: boolean) => void;
  toggleGrid: () => void;

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
}

export const useUIStore = create<UIStore>()((set) => ({
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
  setViewport: (x, y) => set({ viewportX: x, viewportY: y }),
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),
  panBy: (dx, dy) =>
    set((state) => ({
      viewportX: state.viewportX + dx,
      viewportY: state.viewportY + dy,
    })),

  showPropertyPanel: false,
  showGrid: false,
  setShowPropertyPanel: (show) => set({ showPropertyPanel: show }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),

  isDrawing: false,
  isDragging: false,
  isPanning: false,
  setIsDrawing: (v) => set({ isDrawing: v }),
  setIsDragging: (v) => set({ isDragging: v }),
  setIsPanning: (v) => set({ isPanning: v }),

  cursorStyle: 'default',
  setCursorStyle: (style) => set({ cursorStyle: style }),
}));
