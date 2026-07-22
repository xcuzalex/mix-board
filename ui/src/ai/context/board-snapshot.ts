import { getLinearAbsolutePoints } from '../../canvas/linear';
import { useDocumentStore } from '../../store/document';
import type { Element, MindmapNode } from '../../types/element';
import type { SelectionContext } from './selection-context';

export interface BoardSnapshotElement {
  id: string;
  type: Element['type'];
  bounds: { x: number; y: number; width: number; height: number };
  text?: string;
  title?: string;
  shapeVariant?: string;
  groupIds?: string[];
  frameId?: string | null;
  containerId?: string | null;
  childElementIds?: string[];
  childCount?: number;
  connector?: {
    pointCount: number;
    startBindingId: string | null;
    endBindingId: string | null;
    start: [number, number] | null;
    end: [number, number] | null;
  };
  mindmap?: {
    nodeCount: number;
    rootText: string;
    preview: string[];
    layout: string;
    branchStyle: string;
  };
}

export interface BoardSnapshot {
  meta: {
    elementCount: number;
    selectedCount: number;
    isEmpty: boolean;
    backgroundColor: string;
    gridEnabled: boolean;
    gridSize: number;
  };
  selection: SelectionContext;
  elements: BoardSnapshotElement[];
}

export interface PromptSafeBoardSnapshotElement {
  id: string;
  type: Element['type'];
  bounds: { x: number; y: number; width: number; height: number };
  shapeVariant?: string;
  groupIds?: string[];
  frameId?: string | null;
  containerId?: string | null;
  childElementIds?: string[];
  childCount?: number;
  text?: string;
  title?: string;
  connector?: BoardSnapshotElement['connector'];
  mindmap?: {
    nodeCount: number;
    rootText?: string;
    preview?: string[];
    layout: string;
    branchStyle: string;
  };
  relation?: 'selected' | 'related_connector' | 'related_container' | 'related_element';
}

export interface PromptSafeBoardSnapshot {
  meta: BoardSnapshot['meta'] & {
    promptScope: 'selection' | 'board';
    includedElementCount: number;
  };
  selection: SelectionContext;
  elements: PromptSafeBoardSnapshotElement[];
}

function walkMindmap(node: MindmapNode, visit: (node: MindmapNode, depth: number) => void, depth = 0) {
  visit(node, depth);
  const children = [...node.children, ...node.leftChildren, ...node.rightChildren];
  for (const child of children) {
    walkMindmap(child, visit, depth + 1);
  }
}

function summarizeMindmap(element: Extract<Element, { type: 'mindmap' }>) {
  let nodeCount = 0;
  const preview: string[] = [];

  walkMindmap(element.rootNode, (node, depth) => {
    nodeCount += 1;
    if (preview.length < 12) {
      preview.push(`${'  '.repeat(depth)}- ${node.text}`);
    }
  });

  return {
    nodeCount,
    rootText: element.rootNode.text,
    preview,
    layout: element.layout,
    branchStyle: element.branchStyle,
  };
}

function summarizeElement(element: Element, elements: Element[]): BoardSnapshotElement {
  const base: BoardSnapshotElement = {
    id: element.id,
    type: element.type,
    bounds: {
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width),
      height: Math.round(element.height),
    },
    groupIds: element.groupIds.length > 0 ? [...element.groupIds] : undefined,
    frameId: element.frameId,
    shapeVariant: element.shapeVariant,
  };

  switch (element.type) {
    case 'text':
      return { ...base, text: element.text, containerId: element.containerId };
    case 'sticky_note':
      return { ...base, text: element.text };
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'triangle':
      return { ...base, text: element.text };
    case 'section':
    case 'frame':
      return {
        ...base,
        title: element.title,
        childElementIds: [...element.childElementIds],
        childCount: element.childElementIds.length,
      };
    case 'line':
    case 'arrow': {
      const points = getLinearAbsolutePoints(element, elements);
      return {
        ...base,
        connector: {
          pointCount: element.points.length,
          startBindingId: element.startBinding?.elementId ?? null,
          endBindingId: element.endBinding?.elementId ?? null,
          start: points[0] ?? null,
          end: points[points.length - 1] ?? null,
        },
      };
    }
    case 'mindmap':
      return { ...base, mindmap: summarizeMindmap(element) };
    default:
      return base;
  }
}

export function createBoardSnapshot(input: {
  elements: Element[];
  backgroundColor: string;
  gridEnabled: boolean;
  gridSize: number;
  selection: SelectionContext;
}): BoardSnapshot {
  return {
    meta: {
      elementCount: input.elements.length,
      selectedCount: input.selection.selectedIds.length,
      isEmpty: input.elements.length === 0,
      backgroundColor: input.backgroundColor,
      gridEnabled: input.gridEnabled,
      gridSize: input.gridSize,
    },
    selection: input.selection,
    elements: input.elements.map((element) => summarizeElement(element, input.elements)),
  };
}

export function readBoardSnapshotFromStores(selection: SelectionContext): BoardSnapshot {
  const { elements, appState } = useDocumentStore.getState();
  return createBoardSnapshot({
    elements,
    backgroundColor: appState.viewBackgroundColor,
    gridEnabled: appState.gridEnabled,
    gridSize: appState.gridSize,
    selection,
  });
}

export function stringifyBoardSnapshot(snapshot: BoardSnapshot) {
  return JSON.stringify(snapshot, null, 2);
}

function toMinimalPromptElement(element: BoardSnapshotElement): PromptSafeBoardSnapshotElement {
  return {
    id: element.id,
    type: element.type,
    bounds: element.bounds,
    shapeVariant: element.shapeVariant,
    groupIds: element.groupIds,
    frameId: element.frameId,
    containerId: element.containerId,
    childElementIds: element.childElementIds,
    childCount: element.childCount,
    connector: element.connector,
    mindmap: element.mindmap
      ? {
          nodeCount: element.mindmap.nodeCount,
          layout: element.mindmap.layout,
          branchStyle: element.mindmap.branchStyle,
        }
      : undefined,
  };
}

function toDetailedPromptElement(
  element: BoardSnapshotElement,
  relation: PromptSafeBoardSnapshotElement['relation'],
): PromptSafeBoardSnapshotElement {
  return {
    ...toMinimalPromptElement(element),
    text: element.text,
    title: element.title,
    mindmap: element.mindmap
      ? {
          nodeCount: element.mindmap.nodeCount,
          rootText: element.mindmap.rootText,
          preview: element.mindmap.preview,
          layout: element.mindmap.layout,
          branchStyle: element.mindmap.branchStyle,
        }
      : undefined,
    relation,
  };
}

function toRelatedPromptElement(
  element: BoardSnapshotElement,
  relation: Exclude<PromptSafeBoardSnapshotElement['relation'], 'selected'>,
): PromptSafeBoardSnapshotElement {
  const promptElement = toMinimalPromptElement(element);
  if (relation === 'related_container') {
    promptElement.title = element.title;
  }
  return { ...promptElement, relation };
}

function deriveSelectionScopedSnapshot(
  snapshot: BoardSnapshot,
  selectionContext: SelectionContext,
): PromptSafeBoardSnapshot {
  const selectedIdSet = new Set(selectionContext.selectedIds);
  const relevantIds = new Set(selectionContext.selectedIds);
  const elementsById = new Map(snapshot.elements.map((element) => [element.id, element]));

  for (const element of snapshot.elements) {
    if (!selectedIdSet.has(element.id)) {
      continue;
    }

    if (element.frameId) {
      relevantIds.add(element.frameId);
    }

    if (element.containerId) {
      relevantIds.add(element.containerId);
    }

    for (const container of snapshot.elements) {
      if (container.childElementIds?.includes(element.id)) {
        relevantIds.add(container.id);
      }
    }

    if (element.type === 'line' || element.type === 'arrow') {
      if (element.connector?.startBindingId) {
        relevantIds.add(element.connector.startBindingId);
      }
      if (element.connector?.endBindingId) {
        relevantIds.add(element.connector.endBindingId);
      }
    }
  }

  for (const element of snapshot.elements) {
    const isBoundToSelection =
      (element.connector?.startBindingId && selectedIdSet.has(element.connector.startBindingId)) ||
      (element.connector?.endBindingId && selectedIdSet.has(element.connector.endBindingId));
    if (isBoundToSelection) {
      relevantIds.add(element.id);
    }
  }

  for (const selectedId of selectionContext.selectedIds) {
    const selected = elementsById.get(selectedId);
    if (selected?.childElementIds) {
      for (const childId of selected.childElementIds) {
        relevantIds.add(childId);
      }
    }
  }

  const elements = snapshot.elements
    .filter((element) => relevantIds.has(element.id))
    .map((element) => {
      if (selectedIdSet.has(element.id)) {
        return toDetailedPromptElement(element, 'selected');
      }
      if (element.type === 'line' || element.type === 'arrow') {
        return toRelatedPromptElement(element, 'related_connector');
      }
      if (element.type === 'section' || element.type === 'frame') {
        return toRelatedPromptElement(element, 'related_container');
      }
      return toRelatedPromptElement(element, 'related_element');
    });

  return {
    meta: {
      ...snapshot.meta,
      promptScope: 'selection',
      includedElementCount: elements.length,
    },
    selection: snapshot.selection,
    elements,
  };
}

function deriveMinimalBoardSnapshot(snapshot: BoardSnapshot): PromptSafeBoardSnapshot {
  const elements = snapshot.elements.map((element) => toMinimalPromptElement(element));
  return {
    meta: {
      ...snapshot.meta,
      promptScope: 'board',
      includedElementCount: elements.length,
    },
    selection: snapshot.selection,
    elements,
  };
}

export function derivePromptSafeBoardSnapshot(
  snapshot: BoardSnapshot,
  selectionContext: SelectionContext,
): PromptSafeBoardSnapshot {
  if (selectionContext.selectedIds.length > 0) {
    return deriveSelectionScopedSnapshot(snapshot, selectionContext);
  }
  return deriveMinimalBoardSnapshot(snapshot);
}
