import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Element } from '../types/element';
import type { AppState } from '../types/document';
import { createDocument } from '../types/document';
import { generateId } from '../utils/id';

interface HistoryEntry {
  elements: Element[];
}

interface DocumentStore {
  // Document state
  elements: Element[];
  appState: AppState;
  filePath: string | null;
  isDirty: boolean;

  // History
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];

  // Actions
  addElement: (element: Element) => void;
  removeElements: (ids: string[]) => void;
  updateElement: (id: string, updates: Partial<Element>) => void;
  moveElements: (ids: string[], dx: number, dy: number) => void;
  setElements: (elements: Element[]) => void;
  loadDocument: (json: string) => void;
  newDocument: () => void;
  setFilePath: (path: string | null) => void;

  // Layer ordering
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;
  bringForward: (ids: string[]) => void;
  sendBackward: (ids: string[]) => void;

  // Group/Ungroup
  groupElements: (ids: string[]) => string; // returns groupId
  ungroupElements: (ids: string[]) => void;

  // Alignment
  alignElements: (ids: string[], alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  distributeElements: (ids: string[], direction: 'horizontal' | 'vertical') => void;

  // Duplicate
  duplicateElements: (ids: string[]) => string[];

  // History actions
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // App state
  setAppState: (updates: Partial<AppState>) => void;
}

const MAX_HISTORY = 100;

export const useDocumentStore = create<DocumentStore>()(
  immer((set, get) => ({
    elements: [],
    appState: createDocument().appState,
    filePath: null,
    isDirty: false,
    undoStack: [],
    redoStack: [],

    addElement: (element) =>
      set((state) => {
        state.elements.push(element);
        state.isDirty = true;
      }),

    removeElements: (ids) =>
      set((state) => {
        const idSet = new Set(ids);
        state.elements = state.elements.filter((e) => !idSet.has(e.id));
        state.isDirty = true;
      }),

    updateElement: (id, updates) =>
      set((state) => {
        for (let i = 0; i < state.elements.length; i++) {
          if (state.elements[i].id === id) {
            Object.assign(state.elements[i], updates, { updatedAt: Date.now() });
            state.isDirty = true;
            break;
          }
        }
      }),

    moveElements: (ids, dx, dy) =>
      set((state) => {
        const idSet = new Set(ids);
        for (const el of state.elements) {
          if (idSet.has(el.id)) {
            el.x += dx;
            el.y += dy;
            el.updatedAt = Date.now();
          }
        }
        state.isDirty = true;
      }),

    setElements: (elements) =>
      set((state) => {
        state.elements = elements;
        state.isDirty = true;
      }),

    loadDocument: (json) =>
      set((state) => {
        try {
          const doc = JSON.parse(json);
          state.elements = doc.elements || [];
          state.appState = doc.appState || createDocument().appState;
          state.isDirty = false;
          state.undoStack = [];
          state.redoStack = [];
        } catch {
          console.error('Failed to load document');
        }
      }),

    newDocument: () =>
      set((state) => {
        const doc = createDocument();
        state.elements = doc.elements;
        state.appState = doc.appState;
        state.filePath = null;
        state.isDirty = false;
        state.undoStack = [];
        state.redoStack = [];
      }),

    setFilePath: (path) =>
      set((state) => {
        state.filePath = path;
      }),

    // Layer ordering
    bringToFront: (ids) =>
      set((state) => {
        const idSet = new Set(ids);
        const toMove = state.elements.filter(e => idSet.has(e.id));
        const rest = state.elements.filter(e => !idSet.has(e.id));
        state.elements = [...rest, ...toMove];
        state.isDirty = true;
      }),

    sendToBack: (ids) =>
      set((state) => {
        const idSet = new Set(ids);
        const toMove = state.elements.filter(e => idSet.has(e.id));
        const rest = state.elements.filter(e => !idSet.has(e.id));
        state.elements = [...toMove, ...rest];
        state.isDirty = true;
      }),

    bringForward: (ids) =>
      set((state) => {
        const idSet = new Set(ids);
        const elements = [...state.elements];
        for (let i = elements.length - 2; i >= 0; i--) {
          if (idSet.has(elements[i].id) && !idSet.has(elements[i + 1].id)) {
            [elements[i], elements[i + 1]] = [elements[i + 1], elements[i]];
          }
        }
        state.elements = elements;
        state.isDirty = true;
      }),

    sendBackward: (ids) =>
      set((state) => {
        const idSet = new Set(ids);
        const elements = [...state.elements];
        for (let i = 1; i < elements.length; i++) {
          if (idSet.has(elements[i].id) && !idSet.has(elements[i - 1].id)) {
            [elements[i], elements[i - 1]] = [elements[i - 1], elements[i]];
          }
        }
        state.elements = elements;
        state.isDirty = true;
      }),

    // Alignment
    alignElements: (ids, alignment) =>
      set((state) => {
        const idSet = new Set(ids);
        const targets = state.elements.filter(e => idSet.has(e.id));
        if (targets.length < 2) return;

        let ref: number;
        switch (alignment) {
          case 'left':
            ref = Math.min(...targets.map(e => e.x));
            targets.forEach(e => { e.x = ref; e.updatedAt = Date.now(); });
            break;
          case 'center': {
            const minX = Math.min(...targets.map(e => e.x));
            const maxX = Math.max(...targets.map(e => e.x + e.width));
            ref = (minX + maxX) / 2;
            targets.forEach(e => { e.x = ref - e.width / 2; e.updatedAt = Date.now(); });
            break;
          }
          case 'right':
            ref = Math.max(...targets.map(e => e.x + e.width));
            targets.forEach(e => { e.x = ref - e.width; e.updatedAt = Date.now(); });
            break;
          case 'top':
            ref = Math.min(...targets.map(e => e.y));
            targets.forEach(e => { e.y = ref; e.updatedAt = Date.now(); });
            break;
          case 'middle': {
            const minY = Math.min(...targets.map(e => e.y));
            const maxY = Math.max(...targets.map(e => e.y + e.height));
            ref = (minY + maxY) / 2;
            targets.forEach(e => { e.y = ref - e.height / 2; e.updatedAt = Date.now(); });
            break;
          }
          case 'bottom':
            ref = Math.max(...targets.map(e => e.y + e.height));
            targets.forEach(e => { e.y = ref - e.height; e.updatedAt = Date.now(); });
            break;
        }
        state.isDirty = true;
      }),

    distributeElements: (ids, direction) =>
      set((state) => {
        const idSet = new Set(ids);
        const targets = state.elements.filter(e => idSet.has(e.id));
        if (targets.length < 3) return;

        if (direction === 'horizontal') {
          targets.sort((a, b) => a.x - b.x);
          const totalWidth = targets.reduce((sum, e) => sum + e.width, 0);
          const minX = targets[0].x;
          const maxX = targets[targets.length - 1].x + targets[targets.length - 1].width;
          const gap = (maxX - minX - totalWidth) / (targets.length - 1);
          let currentX = minX;
          for (const el of targets) {
            el.x = currentX;
            el.updatedAt = Date.now();
            currentX += el.width + gap;
          }
        } else {
          targets.sort((a, b) => a.y - b.y);
          const totalHeight = targets.reduce((sum, e) => sum + e.height, 0);
          const minY = targets[0].y;
          const maxY = targets[targets.length - 1].y + targets[targets.length - 1].height;
          const gap = (maxY - minY - totalHeight) / (targets.length - 1);
          let currentY = minY;
          for (const el of targets) {
            el.y = currentY;
            el.updatedAt = Date.now();
            currentY += el.height + gap;
          }
        }
        state.isDirty = true;
      }),

    // Group/Ungroup
    groupElements: (ids) => {
      const groupId = generateId();
      set((state) => {
        const idSet = new Set(ids);
        for (const el of state.elements) {
          if (idSet.has(el.id)) {
            el.groupIds = [...el.groupIds, groupId];
            el.updatedAt = Date.now();
          }
        }
        state.isDirty = true;
      });
      return groupId;
    },

    ungroupElements: (ids) =>
      set((state) => {
        const idSet = new Set(ids);
        const groupIdsToRemove = new Set<string>();
        for (const el of state.elements) {
          if (idSet.has(el.id) && el.groupIds.length > 0) {
            groupIdsToRemove.add(el.groupIds[el.groupIds.length - 1]);
          }
        }
        for (const el of state.elements) {
          const newGroupIds = el.groupIds.filter(gid => !groupIdsToRemove.has(gid));
          if (newGroupIds.length !== el.groupIds.length) {
            el.groupIds = newGroupIds;
            el.updatedAt = Date.now();
          }
        }
        state.isDirty = true;
      }),

    // Duplicate
    duplicateElements: (ids) => {
      const newIds: string[] = [];
      set((state) => {
        for (const id of ids) {
          const el = state.elements.find(e => e.id === id);
          if (!el) continue;
          const newId = generateId();
          newIds.push(newId);
          const cloned = structuredClone(el);
          cloned.id = newId;
          cloned.x += 20;
          cloned.y += 20;
          cloned.createdAt = Date.now();
          cloned.updatedAt = Date.now();
          state.elements.push(cloned);
        }
        state.isDirty = true;
      });
      return newIds;
    },

    pushHistory: () =>
      set((state) => {
        const entry: HistoryEntry = {
          elements: structuredClone(get().elements),
        };
        state.undoStack.push(entry);
        if (state.undoStack.length > MAX_HISTORY) {
          state.undoStack.shift();
        }
        state.redoStack = [];
      }),

    undo: () => {
      const { undoStack, elements } = get();
      if (undoStack.length === 0) return;
      set((state) => {
        const entry = state.undoStack.pop()!;
        state.redoStack.push({
          elements: structuredClone(elements),
        });
        state.elements = entry.elements;
        state.isDirty = true;
      });
    },

    redo: () => {
      const { redoStack, elements } = get();
      if (redoStack.length === 0) return;
      set((state) => {
        const entry = state.redoStack.pop()!;
        state.undoStack.push({
          elements: structuredClone(elements),
        });
        state.elements = entry.elements;
        state.isDirty = true;
      });
    },

    setAppState: (updates) =>
      set((state) => {
        Object.assign(state.appState, updates);
      }),
  })),
);
