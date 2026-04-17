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
    case 'sticky_note':
      return { ...base, text: element.text };
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'triangle':
      return { ...base, text: element.text };
    case 'section':
    case 'frame':
      return { ...base, title: element.title };
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
