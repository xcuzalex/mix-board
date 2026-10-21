import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Element } from "../types/element";
import type { AppState, EmbeddedFile } from "../types/document";
import { createDocument } from "../types/document";
import { generateId } from "../utils/id";
import { cloneElementsWithNewIds } from "../utils/clone-elements";
import { queueHydrateEmbeddedFiles } from "../utils/embedded-files";
import { parseBoardFile } from "../utils/board-format";

interface HistoryEntry {
  elements: Element[];
  appState: AppState;
  files: Record<string, EmbeddedFile>;
}

export interface DocumentTransactionDraft {
  elements: Element[];
  appState: AppState;
  files: Record<string, EmbeddedFile>;
}

interface DocumentStore {
  // Document state
  elements: Element[];
  appState: AppState;
  files: Record<string, EmbeddedFile>;
  filePath: string | null;
  /**
   * Version of the file (on disk) that the board's content is based on, as
   * reported by the native side; passed back when saving so edits made on
   * another Mac are kept instead of overwritten. '' = unknown (a restored
   * draft); null = none yet (the next save simply writes).
   */
  fileVersion: string | null;
  /** Bumped whenever another board replaces this one (load / new): async work started on one board checks it before landing. */
  session: number;
  isDirty: boolean;

  // History
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];

  // Actions
  addElement: (element: Element) => void;
  removeElements: (ids: string[]) => void;
  updateElement: (id: string, updates: Partial<Element>) => void;
  addEmbeddedFile: (file: EmbeddedFile) => void;
  /**
   * Replaces the board with a saved file's contents; on failure returns why
   * ('invalid' or 'newer' format) and leaves the board untouched. The caller
   * sets the file path and version (`setFilePath`).
   */
  loadDocument: (json: string) => true | 'invalid' | 'newer';
  newDocument: () => void;
  /** Sets the open file and the version its content is based on. */
  setFilePath: (path: string | null, version: string | null) => void;
  applyTransaction: (
    recipe: (draft: DocumentTransactionDraft) => void,
    options?: { pushHistory?: boolean; markDirty?: boolean },
  ) => void;

  // Layer ordering
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;
  bringForward: (ids: string[]) => void;
  sendBackward: (ids: string[]) => void;

  // Group/Ungroup
  groupElements: (ids: string[]) => string; // returns groupId
  ungroupElements: (ids: string[]) => void;

  // Alignment
  alignElements: (
    ids: string[],
    alignment: "left" | "center" | "right" | "top" | "middle" | "bottom",
  ) => void;
  distributeElements: (
    ids: string[],
    direction: "horizontal" | "vertical",
  ) => void;

  // Duplicate
  duplicateElements: (ids: string[]) => string[];

  // History actions
  /**
   * Marks the current state as an undo checkpoint. It is recorded only once
   * the document actually changes, so gestures that end up changing nothing
   * (a click, an edit left unchanged) add no undo step and keep redo intact.
   */
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
}

const MAX_HISTORY = 100;

// Store state is immutable (Immer freezes it), so history entries can share it
// by reference instead of deep-copying every element and embedded image.
function snapshotOf(
  state: Pick<DocumentStore, "elements" | "appState" | "files">,
): HistoryEntry {
  return { elements: state.elements, appState: state.appState, files: state.files };
}

/** Checkpoint waiting for the first real change (see `pushHistory`). */
let pendingCheckpoint: HistoryEntry | null = null;

export const useDocumentStore = create<DocumentStore>()(
  immer((set, get) => ({
    elements: [],
    appState: createDocument().appState,
    files: createDocument().files,
    filePath: null,
    fileVersion: null,
    session: 0,
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

    addEmbeddedFile: (file) =>
      set((state) => {
        state.files[file.id] = file;
        state.isDirty = true;
      }),

    loadDocument: (json) => {
      const parsed = parseBoardFile(json);
      if (!parsed.ok) return parsed.reason;
      const { board } = parsed;
      pendingCheckpoint = null;
      set((state) => {
        state.elements = board.elements;
        state.appState = board.appState;
        state.files = board.files;
        state.isDirty = false;
        state.undoStack = [];
        state.redoStack = [];
        state.session += 1;
      });
      queueHydrateEmbeddedFiles(board.files);
      return true;
    },

    newDocument: () => {
      pendingCheckpoint = null;
      set((state) => {
        const doc = createDocument();
        state.elements = doc.elements;
        state.appState = doc.appState;
        state.files = doc.files;
        state.filePath = null;
        state.fileVersion = null;
        state.session += 1;
        state.isDirty = false;
        state.undoStack = [];
        state.redoStack = [];
        queueHydrateEmbeddedFiles(doc.files);
      });
    },

    setFilePath: (path, version) =>
      set((state) => {
        state.filePath = path;
        state.fileVersion = version;
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
          case "left":
            ref = Math.min(...targets.map((e) => e.x));
            targets.forEach((e) => {
              e.x = ref;
              e.updatedAt = Date.now();
            });
            break;
          case "center": {
            const minX = Math.min(...targets.map((e) => e.x));
            const maxX = Math.max(...targets.map((e) => e.x + e.width));
            ref = (minX + maxX) / 2;
            targets.forEach((e) => {
              e.x = ref - e.width / 2;
              e.updatedAt = Date.now();
            });
            break;
          }
          case "right":
            ref = Math.max(...targets.map((e) => e.x + e.width));
            targets.forEach((e) => {
              e.x = ref - e.width;
              e.updatedAt = Date.now();
            });
            break;
          case "top":
            ref = Math.min(...targets.map((e) => e.y));
            targets.forEach((e) => {
              e.y = ref;
              e.updatedAt = Date.now();
            });
            break;
          case "middle": {
            const minY = Math.min(...targets.map((e) => e.y));
            const maxY = Math.max(...targets.map((e) => e.y + e.height));
            ref = (minY + maxY) / 2;
            targets.forEach((e) => {
              e.y = ref - e.height / 2;
              e.updatedAt = Date.now();
            });
            break;
          }
          case "bottom":
            ref = Math.max(...targets.map((e) => e.y + e.height));
            targets.forEach((e) => {
              e.y = ref - e.height;
              e.updatedAt = Date.now();
            });
            break;
        }
        state.isDirty = true;
      }),

    distributeElements: (ids, direction) =>
      set((state) => {
        const idSet = new Set(ids);
        const targets = state.elements.filter(e => idSet.has(e.id));
        if (targets.length < 3) return;

        if (direction === "horizontal") {
          targets.sort((a, b) => a.x - b.x);
          const totalWidth = targets.reduce((sum, e) => sum + e.width, 0);
          const minX = targets[0].x;
          const maxX =
            targets[targets.length - 1].x + targets[targets.length - 1].width;
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
          const maxY =
            targets[targets.length - 1].y + targets[targets.length - 1].height;
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
          const newGroupIds = el.groupIds.filter(
            (gid) => !groupIdsToRemove.has(gid),
          );
          if (newGroupIds.length !== el.groupIds.length) {
            el.groupIds = newGroupIds;
            el.updatedAt = Date.now();
          }
        }
        state.isDirty = true;
      }),

    // Duplicate
    duplicateElements: (ids) => {
      const idSet = new Set(ids);
      const copies = cloneElementsWithNewIds(get().elements.filter((e) => idSet.has(e.id)), 20);
      set((state) => {
        state.elements.push(...copies);
        state.isDirty = true;
      });
      return copies.map((el) => el.id);
    },

    pushHistory: () => {
      pendingCheckpoint = snapshotOf(get());
    },

    undo: () => {
      pendingCheckpoint = null;
      const { undoStack } = get();
      if (undoStack.length === 0) return;
      const currentEntry = snapshotOf(get());
      set((state) => {
        const entry = state.undoStack.pop()!;
        state.redoStack.push(currentEntry);
        state.elements = entry.elements;
        state.appState = entry.appState;
        state.files = entry.files;
        state.isDirty = true;
        queueHydrateEmbeddedFiles(entry.files);
      });
    },

    redo: () => {
      pendingCheckpoint = null;
      const { redoStack } = get();
      if (redoStack.length === 0) return;
      const currentEntry = snapshotOf(get());
      set((state) => {
        const entry = state.redoStack.pop()!;
        state.undoStack.push(currentEntry);
        state.elements = entry.elements;
        state.appState = entry.appState;
        state.files = entry.files;
        state.isDirty = true;
        queueHydrateEmbeddedFiles(entry.files);
      });
    },

    applyTransaction: (recipe, options) => {
      if (options?.pushHistory) pendingCheckpoint = snapshotOf(get());
      set((state) => {
        recipe(state as unknown as DocumentTransactionDraft);
        if (options?.markDirty ?? true) {
          state.isDirty = true;
        }
      });
    },
  })),
);

// Record a pending checkpoint the moment the document content first changes.
useDocumentStore.subscribe((state, prev) => {
  if (!pendingCheckpoint) return;
  if (state.elements === prev.elements && state.appState === prev.appState && state.files === prev.files) return;
  const entry = pendingCheckpoint;
  pendingCheckpoint = null;
  useDocumentStore.setState((draft) => {
    draft.undoStack.push(entry);
    if (draft.undoStack.length > MAX_HISTORY) draft.undoStack.shift();
    draft.redoStack = [];
  });
});
