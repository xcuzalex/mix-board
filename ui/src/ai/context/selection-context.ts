import { useDocumentStore } from '../../store/document';
import { useUIStore } from '../../store/ui';
import type { Element } from '../../types/element';
import type { ToolType } from '../../types/tool';

export interface SelectionContextElement {
  id: string;
  type: Element['type'];
  label: string;
}

export interface SelectionContext {
  activeTool: ToolType;
  selectedIds: string[];
  selectedElements: SelectionContextElement[];
  viewportCenter: { x: number; y: number };
  zoom: number;
  isCanvasEmpty: boolean;
}

function getElementLabel(element: Element) {
  switch (element.type) {
    case 'text':
    case 'sticky_note':
      return element.text || element.id;
    case 'section':
    case 'frame':
      return element.title || element.id;
    case 'mindmap':
      return element.rootNode.text || element.id;
    case 'line':
    case 'arrow':
      return `${element.type}:${element.id}`;
    default:
      return element.text || element.id;
  }
}

export function buildSelectionContext(input: {
  elements: Element[];
  selectedIds: string[];
  activeTool: ToolType;
  viewportX: number;
  viewportY: number;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
}): SelectionContext {
  const selectedElements = input.elements
    .filter((element) => input.selectedIds.includes(element.id))
    .map((element) => ({
      id: element.id,
      type: element.type,
      label: getElementLabel(element),
    }));

  return {
    activeTool: input.activeTool,
    selectedIds: [...input.selectedIds],
    selectedElements,
    viewportCenter: {
      x: Math.round((input.viewportWidth / 2 - input.viewportX) / input.zoom),
      y: Math.round((input.viewportHeight / 2 - input.viewportY) / input.zoom),
    },
    zoom: input.zoom,
    isCanvasEmpty: input.elements.length === 0,
  };
}

export function readSelectionContextFromStores(viewportSize?: { width?: number; height?: number }): SelectionContext {
  const { elements } = useDocumentStore.getState();
  const uiState = useUIStore.getState();

  const viewportWidth = viewportSize?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 0);
  const viewportHeight = viewportSize?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0);

  return buildSelectionContext({
    elements,
    selectedIds: uiState.selectedIds,
    activeTool: uiState.activeTool,
    viewportX: uiState.viewportX,
    viewportY: uiState.viewportY,
    zoom: uiState.zoom,
    viewportWidth,
    viewportHeight,
  });
}
