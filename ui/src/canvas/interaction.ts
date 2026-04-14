import type {
  Element, RectangleElement, EllipseElement, DiamondElement,
  TriangleElement, LinearElement, FreedrawElement, HighlighterElement,
  TextElement, StickyNoteElement, SectionElement, FrameElement,
  ImageElement, MindmapElement, ShapeVariant,
} from '../types/element';
import type { ToolType } from '../types/tool';
import { createBaseProperties } from '../types/element';
import { generateId } from '../utils/id';
import { snapToGrid, snapToElements, type SnapGuide } from '../utils/math';
import { hitTest, getResizeHandle, type HandlePosition } from './hit-test';
import { Viewport } from './viewport';
import {
  findNearestBindableElement,
  getConnectionPointFromBinding,
  getLinearAbsolutePoints,
  getLinearBounds,
  normalizeLinearPoints,
} from './linear';
import { getDefaultShapeVariant, isShapeTool } from './shape-utils';

export interface InteractionState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  activeElement: Element | null;
  resizeHandle: HandlePosition | null;
  originalElements: Map<string, { x: number; y: number; width: number; height: number }>;
}

export function createInteractionState(): InteractionState {
  return {
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    activeElement: null,
    resizeHandle: null,
    originalElements: new Map(),
  };
}

function getElementBounds(
  element: Element,
  elements: Element[],
): { x: number; y: number; width: number; height: number } {
  if (element.type === 'line' || element.type === 'arrow') {
    return getLinearBounds(element as LinearElement, elements);
  }
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
}

function getContainedElementIds(
  container: Element,
  elements: Element[],
): string[] {
  if (container.type !== 'section' && container.type !== 'frame') return [];

  return elements
    .filter((candidate) => candidate.id !== container.id)
    .filter((candidate) => {
      if (candidate.frameId === container.id) return true;
      const bounds = getElementBounds(candidate, elements);
      return (
        bounds.x >= container.x &&
        bounds.y >= container.y &&
        bounds.x + bounds.width <= container.x + container.width &&
        bounds.y + bounds.height <= container.y + container.height
      );
    })
    .map((candidate) => candidate.id);
}

// Default fill colors per shape type
const SHAPE_DEFAULTS: Partial<Record<ToolType, { backgroundColor: string; strokeColor: string }>> = {
  rectangle: { backgroundColor: '#E3EAFD', strokeColor: '#3370FF' },
  ellipse: { backgroundColor: '#FCE4EC', strokeColor: '#E91E63' },
  diamond: { backgroundColor: '#E8F5E9', strokeColor: '#4CAF50' },
  triangle: { backgroundColor: '#FFF3E0', strokeColor: '#FF9800' },
};

const SHAPE_VARIANT_DEFAULTS: Partial<Record<ShapeVariant, { backgroundColor?: string; strokeColor?: string; strokeWidth?: number }>> = {
  actor: { backgroundColor: 'transparent', strokeColor: '#1B1B1F' },
  start_state: { backgroundColor: '#1B1B1F', strokeColor: '#1B1B1F' },
  end_state: { backgroundColor: '#FFFFFF', strokeColor: '#1B1B1F' },
  sync_bar: { backgroundColor: '#1B1B1F', strokeColor: '#1B1B1F' },
};

export function handlePointerDown(
  viewport: Viewport,
  elements: Element[],
  selectedIds: string[],
  activeTool: ToolType,
  activeShapeVariant: ShapeVariant,
  screenX: number,
  screenY: number,
  shiftKey: boolean,
  state: InteractionState,
): {
  action: 'select' | 'draw' | 'drag' | 'resize' | 'pan' | 'none';
  element?: Element;
  selectedIds?: string[];
  handle?: HandlePosition;
} {
  const canvas = viewport.screenToCanvas(screenX, screenY);
  state.startX = canvas.x;
  state.startY = canvas.y;
  state.currentX = canvas.x;
  state.currentY = canvas.y;

  if (activeTool === 'hand') {
    return { action: 'pan' };
  }

  if (activeTool === 'select') {
    // Check resize handles first
    for (const id of selectedIds) {
      const el = elements.find(e => e.id === id);
      if (!el) continue;
      const handle = getResizeHandle(el, elements, canvas.x, canvas.y, 8 / viewport.zoom);
      if (handle) {
        state.resizeHandle = handle;
        state.originalElements = new Map(
          selectedIds.map(sid => {
            const sel = elements.find(e => e.id === sid)!;
            return [sid, { x: sel.x, y: sel.y, width: sel.width, height: sel.height }];
          }),
        );
        return { action: 'resize', handle };
      }
    }

    // For selected lines/arrows: allow drag by clicking anywhere inside the bounding box
    for (const id of selectedIds) {
      const el = elements.find(e => e.id === id);
      if (!el || (el.type !== 'line' && el.type !== 'arrow')) continue;
      const bounds = getLinearBounds(el as LinearElement, elements);
      const pad = 8 / viewport.zoom;
      if (
        canvas.x >= bounds.x - pad && canvas.x <= bounds.x + bounds.width + pad &&
        canvas.y >= bounds.y - pad && canvas.y <= bounds.y + bounds.height + pad
      ) {
        state.originalElements = new Map(
          selectedIds.map(sid => {
            const sel = elements.find(e => e.id === sid)!;
            return [sid, { x: sel.x, y: sel.y, width: sel.width, height: sel.height }];
          }),
        );
        return { action: 'drag', element: el, selectedIds };
      }
    }

    // Hit test
    const hit = hitTest(elements, canvas.x, canvas.y);
    if (hit) {
      // If hit element is in a group, select all elements in the same outermost group
      let groupMembers: string[] = [hit.id];
      if (hit.groupIds.length > 0) {
        const outermostGroup = hit.groupIds[hit.groupIds.length - 1];
        groupMembers = elements
          .filter(e => e.groupIds.includes(outermostGroup))
          .map(e => e.id);
      }

      let newSelected: string[];
      if (shiftKey) {
        if (selectedIds.includes(hit.id)) {
          newSelected = selectedIds.filter(id => !groupMembers.includes(id));
        } else {
          newSelected = [...new Set([...selectedIds, ...groupMembers])];
        }
      } else if (!selectedIds.includes(hit.id)) {
        newSelected = groupMembers;
      } else {
        newSelected = selectedIds;
      }

      const dragIds = (hit.type === 'section' || hit.type === 'frame')
        ? [...new Set([...newSelected, ...getContainedElementIds(hit, elements)])]
        : newSelected;

      // Store original positions for drag
      state.originalElements = new Map(
        dragIds.map(id => {
          const el = elements.find(e => e.id === id)!;
          return [id, { x: el.x, y: el.y, width: el.width, height: el.height }];
        }),
      );

      return { action: 'drag', element: hit, selectedIds: newSelected };
    }

    // Clicked on empty space - start selection box
    return { action: 'select', selectedIds: [] };
  }

  // Drawing tools
  const newElement = createElementForTool(activeTool, canvas.x, canvas.y, {
    shapeVariant: isShapeTool(activeTool) ? activeShapeVariant : undefined,
  });
  if (newElement) {
    if (newElement.type === 'line' || newElement.type === 'arrow') {
      const bindingTarget = findNearestBindableElement(elements, canvas.x, canvas.y, 16 / viewport.zoom);
      const startPoint = bindingTarget?.point ?? [canvas.x, canvas.y];
      newElement.startBinding = bindingTarget
        ? { elementId: bindingTarget.element.id, focus: bindingTarget.focus, gap: 0 }
        : null;
      newElement.endBinding = null;
      Object.assign(newElement, normalizeLinearPoints([startPoint, startPoint]));
    }
    state.activeElement = newElement;
    return { action: 'draw', element: newElement };
  }

  return { action: 'none' };
}

export function handlePointerMove(
  viewport: Viewport,
  screenX: number,
  screenY: number,
  action: string,
  state: InteractionState,
  _elements: Element[],
  selectedIds: string[],
  gridEnabled?: boolean,
  gridSize?: number,
): {
  updatedElements?: Map<string, Partial<Element>>;
  activeElement?: Element;
  selectionBox?: { x: number; y: number; width: number; height: number };
  snapGuides?: SnapGuide[];
} {
  const canvas = viewport.screenToCanvas(screenX, screenY);
  state.currentX = canvas.x;
  state.currentY = canvas.y;

  const dx = canvas.x - state.startX;
  const dy = canvas.y - state.startY;

  if (action === 'select') {
    // Rubber-band selection box
    const x = Math.min(state.startX, canvas.x);
    const y = Math.min(state.startY, canvas.y);
    const width = Math.abs(dx);
    const height = Math.abs(dy);
    return { selectionBox: { x, y, width, height } };
  }

  if (action === 'draw' && state.activeElement) {
    if (state.activeElement.type === 'freedraw' || state.activeElement.type === 'highlighter') {
      const el = state.activeElement as FreedrawElement | HighlighterElement;
      el.points.push([canvas.x - el.x, canvas.y - el.y]);
      return { activeElement: { ...el } };
    }

    // For shape drawing, update width/height
    const x = Math.min(state.startX, canvas.x);
    const y = Math.min(state.startY, canvas.y);
    const w = Math.abs(dx);
    const h = Math.abs(dy);

    if (state.activeElement.type === 'line' || state.activeElement.type === 'arrow') {
      const el = state.activeElement as LinearElement;
      const startPoint = getConnectionPointFromBinding(_elements, el.startBinding) ?? [
        el.x + (el.points[0]?.[0] ?? 0),
        el.y + (el.points[0]?.[1] ?? 0),
      ];
      const bindingTarget = findNearestBindableElement(_elements, canvas.x, canvas.y, 16 / viewport.zoom);
      const endPoint = bindingTarget?.point ?? [canvas.x, canvas.y];
      el.endBinding = bindingTarget
        ? { elementId: bindingTarget.element.id, focus: bindingTarget.focus, gap: 0 }
        : null;
      Object.assign(el, normalizeLinearPoints([startPoint, endPoint]));
      return { activeElement: { ...el } };
    }

    state.activeElement.x = x;
    state.activeElement.y = y;
    state.activeElement.width = w;
    state.activeElement.height = h;

    return { activeElement: { ...state.activeElement } };
  }

  if (action === 'drag') {
    const updates = new Map<string, Partial<Element>>();

    // Calculate the bounding box of all selected elements at new position
    const allOrig = Array.from(state.originalElements.entries());
    if (allOrig.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [, orig] of allOrig) {
        minX = Math.min(minX, orig.x);
        minY = Math.min(minY, orig.y);
        maxX = Math.max(maxX, orig.x + orig.width);
        maxY = Math.max(maxY, orig.y + orig.height);
      }
      const bboxW = maxX - minX;
      const bboxH = maxY - minY;
      let newX = minX + dx;
      let newY = minY + dy;

      let snapGuides: SnapGuide[] = [];

      if (gridEnabled && gridSize) {
        newX = snapToGrid(newX, gridSize);
        newY = snapToGrid(newY, gridSize);
      } else {
        // Snap to other elements
        const snapResult = snapToElements(newX, newY, bboxW, bboxH, _elements, selectedIds);
        newX = snapResult.x;
        newY = snapResult.y;
        snapGuides = snapResult.guides;
      }

      const snapDx = newX - minX;
      const snapDy = newY - minY;

      for (const [id, orig] of allOrig) {
        updates.set(id, { x: orig.x + snapDx, y: orig.y + snapDy });
      }

      return { updatedElements: updates, snapGuides };
    }

    return { updatedElements: updates };
  }

  if (action === 'resize' && state.resizeHandle) {
    const updates = new Map<string, Partial<Element>>();
    if (state.resizeHandle === 'start' || state.resizeHandle === 'end') {
      for (const id of selectedIds) {
        const element = _elements.find((candidate) => candidate.id === id);
        if (!element || (element.type !== 'line' && element.type !== 'arrow')) continue;

        const linear = element as LinearElement;
        const points = getLinearAbsolutePoints(linear, _elements);
        if (points.length < 2) continue;

        const bindingTarget = findNearestBindableElement(_elements, canvas.x, canvas.y, 16 / viewport.zoom);
        const nextPoint = bindingTarget?.point ?? ([canvas.x, canvas.y] as [number, number]);
        const nextPoints = [...points] as [number, number][];

        if (state.resizeHandle === 'start') {
          nextPoints[0] = nextPoint;
          updates.set(id, {
            ...normalizeLinearPoints(nextPoints),
            startBinding: bindingTarget
              ? { elementId: bindingTarget.element.id, focus: bindingTarget.focus, gap: 0 }
              : null,
            endBinding: linear.endBinding,
          } as Partial<Element>);
        } else {
          nextPoints[nextPoints.length - 1] = nextPoint;
          updates.set(id, {
            ...normalizeLinearPoints(nextPoints),
            startBinding: linear.startBinding,
            endBinding: bindingTarget
              ? { elementId: bindingTarget.element.id, focus: bindingTarget.focus, gap: 0 }
              : null,
          } as Partial<Element>);
        }
      }
      return { updatedElements: updates };
    }

    for (const id of selectedIds) {
      const orig = state.originalElements.get(id);
      if (!orig) continue;
      const resized = applyResize(orig, state.resizeHandle, dx, dy);
      updates.set(id, resized);
    }
    return { updatedElements: updates };
  }

  return {};
}

function applyResize(
  orig: { x: number; y: number; width: number; height: number },
  handle: HandlePosition,
  dx: number,
  dy: number,
): Partial<Element> {
  let { x, y, width, height } = orig;

  switch (handle) {
    case 'se':
      width += dx;
      height += dy;
      break;
    case 'e':
      width += dx;
      break;
    case 's':
      height += dy;
      break;
    case 'nw':
      x += dx;
      y += dy;
      width -= dx;
      height -= dy;
      break;
    case 'n':
      y += dy;
      height -= dy;
      break;
    case 'ne':
      y += dy;
      width += dx;
      height -= dy;
      break;
    case 'sw':
      x += dx;
      width -= dx;
      height += dy;
      break;
    case 'w':
      x += dx;
      width -= dx;
      break;
  }

  // Ensure minimum size
  if (width < 1) { width = 1; }
  if (height < 1) { height = 1; }

  return { x, y, width, height } as Partial<Element>;
}

export function createElementForTool(
  tool: ToolType,
  x: number,
  y: number,
  options: { shapeVariant?: ShapeVariant } = {},
): Element | null {
  const id = generateId();
  const base = createBaseProperties(id, x, y, 0, 0);
  const defaults = SHAPE_DEFAULTS[tool];
  const shapeVariant = options.shapeVariant ?? (isShapeTool(tool) ? getDefaultShapeVariant(tool) : undefined);

  if (defaults) {
    base.backgroundColor = defaults.backgroundColor;
    base.strokeColor = defaults.strokeColor;
  }
  if (shapeVariant) {
    const variantDefaults = SHAPE_VARIANT_DEFAULTS[shapeVariant];
    if (variantDefaults?.backgroundColor !== undefined) {
      base.backgroundColor = variantDefaults.backgroundColor;
    }
    if (variantDefaults?.strokeColor !== undefined) {
      base.strokeColor = variantDefaults.strokeColor;
    }
    if (variantDefaults?.strokeWidth !== undefined) {
      base.strokeWidth = variantDefaults.strokeWidth;
    }
  }

  switch (tool) {
    case 'rectangle':
      return {
        ...base,
        type: 'rectangle',
        roundness: shapeVariant === 'pill' ? 999 : shapeVariant === 'round_rectangle' ? 18 : 8,
        shapeVariant,
      } as RectangleElement;
    case 'ellipse':
      return { ...base, type: 'ellipse', shapeVariant } as EllipseElement;
    case 'diamond':
      return { ...base, type: 'diamond', shapeVariant } as DiamondElement;
    case 'triangle':
      return { ...base, type: 'triangle', shapeVariant } as TriangleElement;
    case 'line':
      return {
        ...base, type: 'line',
        connectorShape: 'straight',
        points: [[0, 0], [0, 0]],
        startBinding: null, endBinding: null,
        startArrowType: 'none', endArrowType: 'none',
      } as LinearElement;
    case 'arrow':
      return {
        ...base, type: 'arrow',
        connectorShape: 'straight',
        points: [[0, 0], [0, 0]],
        startBinding: null, endBinding: null,
        startArrowType: 'none', endArrowType: 'arrow',
        strokeColor: '#1B1B1F',
      } as LinearElement;
    case 'freedraw':
      return {
        ...base, type: 'freedraw',
        points: [],
        pressures: [],
        strokeWidth: 3,
        strokeColor: '#1B1B1F',
        backgroundColor: 'transparent',
      } as FreedrawElement;
    case 'highlighter':
      return {
        ...base, type: 'highlighter',
        points: [],
        pressures: [],
        strokeWidth: 20,
        strokeColor: 'transparent',
        backgroundColor: 'transparent',
        highlightColor: 'rgba(255, 235, 59, 0.4)',
        opacity: 100,
      } as HighlighterElement;
    case 'section':
      return {
        ...base, type: 'section',
        title: '分区',
        childElementIds: [],
        strokeColor: '#8B8FA3',
        backgroundColor: 'rgba(0, 0, 0, 0.02)',
      } as SectionElement;
    case 'frame':
      return {
        ...base, type: 'frame',
        title: '框架',
        childElementIds: [],
        strokeColor: '#8B8FA3',
        backgroundColor: 'transparent',
      } as FrameElement;
    case 'text':
      return {
        ...base, type: 'text',
        text: '',
        fontSize: 20,
        fontFamily: 'Inter, system-ui, sans-serif',
        textAlign: 'left',
        verticalAlign: 'top',
        containerId: null,
        width: 200,
        height: 30,
        strokeColor: '#1B1B1F',
        backgroundColor: 'transparent',
      } as TextElement;
    case 'sticky_note':
      return {
        ...base, type: 'sticky_note',
        text: '',
        fontSize: 16,
        noteColor: 'yellow',
        width: 200,
        height: 200,
        backgroundColor: '#FFF9C4',
      } as StickyNoteElement;
    case 'image':
      return {
        ...base, type: 'image',
        fileId: '',
        scale: [1, 1],
        width: 200,
        height: 200,
        strokeWidth: 0,
        strokeColor: 'transparent',
        backgroundColor: '#F5F6F7',
      } as ImageElement;
    case 'mindmap':
      return {
        ...base, type: 'mindmap',
        layout: 'mindmap_right',
        branchStyle: 'curve',
        lineStyle: { color: '#7AA692', width: 2.5, style: 'solid' },
        width: 400,
        height: 200,
        strokeWidth: 0,
        backgroundColor: 'transparent',
        rootNode: {
          id: generateId(),
          text: '中心主题',
          nodeType: 'root',
          nodeShape: 'pill',
          backgroundColor: '#2F6B55',
          textColor: '#FFFFFF',
          fontSize: 16,
          collapsed: false,
          children: [
            {
              id: generateId(),
              text: '分支 1',
              nodeType: 'branch',
              nodeShape: 'rounded_rect',
              backgroundColor: '#E7F5EE',
              textColor: '#234032',
              fontSize: 14,
              collapsed: false,
              children: [],
              leftChildren: [],
              rightChildren: [],
            },
            {
              id: generateId(),
              text: '分支 2',
              nodeType: 'branch',
              nodeShape: 'rounded_rect',
              backgroundColor: '#E7F5EE',
              textColor: '#234032',
              fontSize: 14,
              collapsed: false,
              children: [],
              leftChildren: [],
              rightChildren: [],
            },
          ],
          leftChildren: [],
          rightChildren: [],
        },
      } as MindmapElement;
    default:
      return null;
  }
}

export function getElementsInSelectionBox(
  elements: Element[],
  box: { x: number; y: number; width: number; height: number },
): string[] {
  const ids: string[] = [];
  for (const el of elements) {
    // Check if element overlaps with selection box
    if (
      el.x < box.x + box.width &&
      el.x + el.width > box.x &&
      el.y < box.y + box.height &&
      el.y + el.height > box.y
    ) {
      ids.push(el.id);
    }
  }
  return ids;
}
