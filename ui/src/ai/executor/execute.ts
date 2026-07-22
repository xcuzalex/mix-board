import { createElementForTool } from '../../canvas/interaction';
import { getConnectionPoints, normalizeLinearPoints } from '../../canvas/linear';
import { useDocumentStore, type DocumentTransactionDraft } from '../../store/document';
import { STICKY_NOTE_COLORS } from '../../utils/color';
import type {
  Element,
  LinearElement,
  StickyNoteElement,
} from '../../types/element';
import type { ToolType } from '../../types/tool';
import type { AISupportedElementType } from '../types';
import type {
  AIOperation,
  AIOperationPlan,
  ConnectElementsOperation,
  ElementReference,
  ElementUpdatePatch,
  ReorderAction,
} from '../schema/types';
import { parseOperationPlan } from '../schema/operation-schema';
import { addMindmapChild, addMindmapSibling, createMindmapNode, findMindmapNode, moveMindmapNode, updateMindmapNode } from './mindmap';
import { registerReference, resolveReferenceElement, resolveReferenceElements, resolveReferenceId } from './refs';

export interface AIOperationExecutionResult {
  summary: string;
  intent: string;
  operationsApplied: number;
  touchedElementIds: string[];
}

function touchElement(element: Element) {
  element.updatedAt = Date.now();
}

function mapElementTypeToTool(type: AISupportedElementType): ToolType {
  switch (type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'triangle':
    case 'text':
    case 'sticky_note':
    case 'line':
    case 'arrow':
    case 'section':
    case 'frame':
    case 'mindmap':
      return type;
    default:
      throw new Error(`Unsupported tool mapping for "${String(type)}".`);
  }
}

function applyStickyNoteColor(element: StickyNoteElement, noteColor: StickyNoteElement['noteColor']) {
  element.noteColor = noteColor;
  element.backgroundColor = STICKY_NOTE_COLORS[noteColor];
}

function applyLinearPoints(element: LinearElement, x: number, y: number, points: [number, number][]) {
  const absolutePoints = points.map(([dx, dy]) => [x + dx, y + dy] as [number, number]);
  const normalized = normalizeLinearPoints(absolutePoints);
  element.x = normalized.x;
  element.y = normalized.y;
  element.width = normalized.width;
  element.height = normalized.height;
  element.points = normalized.points;
}

function applyElementPatch(element: Element, changes: ElementUpdatePatch) {
  if (changes.x !== undefined) element.x = changes.x;
  if (changes.y !== undefined) element.y = changes.y;
  if (changes.width !== undefined) element.width = changes.width;
  if (changes.height !== undefined) element.height = changes.height;
  if (changes.strokeColor !== undefined) element.strokeColor = changes.strokeColor;
  if (changes.strokeWidth !== undefined) element.strokeWidth = changes.strokeWidth;
  if (changes.strokeStyle !== undefined) element.strokeStyle = changes.strokeStyle;
  if (changes.backgroundColor !== undefined) element.backgroundColor = changes.backgroundColor;
  if (changes.fillStyle !== undefined) element.fillStyle = changes.fillStyle;
  if (changes.opacity !== undefined) element.opacity = changes.opacity;
  if (changes.shapeVariant !== undefined) element.shapeVariant = changes.shapeVariant;

  switch (element.type) {
    case 'rectangle':
      if (changes.roundness !== undefined) {
        element.roundness = changes.roundness;
      }
      if (changes.text !== undefined) element.text = changes.text;
      break;
    case 'ellipse':
    case 'diamond':
    case 'triangle':
      if (changes.text !== undefined) element.text = changes.text;
      break;
    case 'text':
      if (changes.text !== undefined) element.text = changes.text;
      if (changes.fontSize !== undefined) element.fontSize = changes.fontSize;
      if (changes.fontFamily !== undefined) element.fontFamily = changes.fontFamily;
      if (changes.textAlign !== undefined) element.textAlign = changes.textAlign;
      break;
    case 'sticky_note':
      if (changes.text !== undefined) element.text = changes.text;
      if (changes.fontSize !== undefined) element.fontSize = changes.fontSize;
      if (changes.noteColor !== undefined) applyStickyNoteColor(element, changes.noteColor);
      break;
    case 'section':
    case 'frame':
      if (changes.title !== undefined) element.title = changes.title;
      break;
    case 'line':
    case 'arrow':
      if (changes.connectorShape !== undefined) element.connectorShape = changes.connectorShape;
      if (changes.startArrowType !== undefined) element.startArrowType = changes.startArrowType;
      if (changes.endArrowType !== undefined) element.endArrowType = changes.endArrowType;
      if (changes.points !== undefined) {
        applyLinearPoints(element, changes.x ?? element.x, changes.y ?? element.y, changes.points);
      }
      break;
    case 'mindmap':
      if (changes.layout !== undefined) element.layout = changes.layout;
      if (changes.branchStyle !== undefined) element.branchStyle = changes.branchStyle;
      if (changes.text !== undefined) {
        element.rootNode = updateMindmapNode(element.rootNode, element.rootNode.id, { text: changes.text });
      }
      break;
    default:
      break;
  }

  touchElement(element);
}

function createElementFromOperation(operation: Extract<AIOperation, { op: 'add_element' }>): Element {
  const tool = mapElementTypeToTool(operation.elementType);
  const element = createElementForTool(tool, operation.props.x, operation.props.y, {
    shapeVariant: operation.props.shapeVariant,
  });

  if (!element) {
    throw new Error(`Failed to create element for type "${operation.elementType}".`);
  }

  applyElementPatch(element, operation.props);

  if (element.type === 'line' || element.type === 'arrow') {
    const points = operation.props.points ?? [
      [0, 0],
      [operation.props.width ?? 160, operation.props.height ?? 0],
    ];
    applyLinearPoints(element, operation.props.x, operation.props.y, points);
  }

  if (element.type === 'mindmap' && operation.props.text) {
    element.rootNode = updateMindmapNode(element.rootNode, element.rootNode.id, { text: operation.props.text });
  }

  if (element.type === 'section' || element.type === 'frame') {
    element.childElementIds = [];
  }

  if (element.type === 'sticky_note' && operation.props.noteColor) {
    applyStickyNoteColor(element, operation.props.noteColor);
  }

  return element;
}

function findBestConnectionPoints(from: Element, to: Element): { start: [number, number]; end: [number, number]; startFocus: number; endFocus: number } {
  const fromPoints = getConnectionPoints(from);
  const toPoints = getConnectionPoints(to);
  let bestDistance = Number.POSITIVE_INFINITY;
  let best: { start: [number, number]; end: [number, number]; startFocus: number; endFocus: number } | null = null;

  for (let fromIndex = 0; fromIndex < fromPoints.length; fromIndex += 1) {
    for (let toIndex = 0; toIndex < toPoints.length; toIndex += 1) {
      const start = fromPoints[fromIndex];
      const end = toPoints[toIndex];
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          start,
          end,
          startFocus: fromIndex / 3,
          endFocus: toIndex / 3,
        };
      }
    }
  }

  if (!best) {
    throw new Error('Failed to compute connection points.');
  }

  return best;
}

function createConnectionElement(operation: ConnectElementsOperation, from: Element, to: Element): LinearElement {
  const tool = operation.connector.type;
  const element = createElementForTool(tool, 0, 0);
  if (!element || (element.type !== 'line' && element.type !== 'arrow')) {
    throw new Error(`Failed to create connector "${tool}".`);
  }

  const best = findBestConnectionPoints(from, to);
  element.startBinding = { elementId: from.id, focus: best.startFocus, gap: 0 };
  element.endBinding = { elementId: to.id, focus: best.endFocus, gap: 0 };
  element.connectorShape = operation.connector.connectorShape ?? element.connectorShape;
  if (operation.connector.startArrowType !== undefined) {
    element.startArrowType = operation.connector.startArrowType;
  }
  if (operation.connector.endArrowType !== undefined) {
    element.endArrowType = operation.connector.endArrowType;
  }

  const normalized = normalizeLinearPoints([best.start, best.end]);
  element.x = normalized.x;
  element.y = normalized.y;
  element.width = normalized.width;
  element.height = normalized.height;
  element.points = normalized.points;
  touchElement(element);
  return element;
}

function resolveMutableElement(
  draft: DocumentTransactionDraft,
  refMap: Map<string, string>,
  reference: ElementReference,
): Element {
  const id = resolveReferenceId(refMap, reference);
  const element = draft.elements.find((candidate) => candidate.id === id);
  if (!element) {
    throw new Error(`Element "${id}" not found.`);
  }
  return element;
}

function applyDelete(draft: DocumentTransactionDraft, refMap: Map<string, string>, references: ElementReference[], touchedIds: Set<string>) {
  const ids = new Set(references.map((reference) => resolveReferenceId(refMap, reference)));
  draft.elements = draft.elements.filter((element) => !ids.has(element.id));

  for (const element of draft.elements) {
    if ((element.type === 'line' || element.type === 'arrow')) {
      if (element.startBinding && ids.has(element.startBinding.elementId)) {
        element.startBinding = null;
        touchElement(element);
        touchedIds.add(element.id);
      }
      if (element.endBinding && ids.has(element.endBinding.elementId)) {
        element.endBinding = null;
        touchElement(element);
        touchedIds.add(element.id);
      }
    }
  }

  ids.forEach((id) => touchedIds.add(id));
}

function applyReorder(elements: Element[], ids: string[], action: ReorderAction) {
  switch (action) {
    case 'bring_to_front': {
      const selected = elements.filter((element) => ids.includes(element.id));
      const rest = elements.filter((element) => !ids.includes(element.id));
      return [...rest, ...selected];
    }
    case 'send_to_back': {
      const selected = elements.filter((element) => ids.includes(element.id));
      const rest = elements.filter((element) => !ids.includes(element.id));
      return [...selected, ...rest];
    }
    case 'bring_forward': {
      const next = [...elements];
      for (let index = next.length - 2; index >= 0; index -= 1) {
        if (ids.includes(next[index].id) && !ids.includes(next[index + 1].id)) {
          [next[index], next[index + 1]] = [next[index + 1], next[index]];
        }
      }
      return next;
    }
    case 'send_backward': {
      const next = [...elements];
      for (let index = 1; index < next.length; index += 1) {
        if (ids.includes(next[index].id) && !ids.includes(next[index - 1].id)) {
          [next[index], next[index - 1]] = [next[index - 1], next[index]];
        }
      }
      return next;
    }
  }
}

function applyAlignment(elements: Element[], ids: string[], alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
  const targets = elements.filter((element) => ids.includes(element.id));
  if (targets.length < 2) return;

  let ref = 0;
  switch (alignment) {
    case 'left':
      ref = Math.min(...targets.map((element) => element.x));
      targets.forEach((element) => { element.x = ref; touchElement(element); });
      break;
    case 'center': {
      const minX = Math.min(...targets.map((element) => element.x));
      const maxX = Math.max(...targets.map((element) => element.x + element.width));
      ref = (minX + maxX) / 2;
      targets.forEach((element) => { element.x = ref - element.width / 2; touchElement(element); });
      break;
    }
    case 'right':
      ref = Math.max(...targets.map((element) => element.x + element.width));
      targets.forEach((element) => { element.x = ref - element.width; touchElement(element); });
      break;
    case 'top':
      ref = Math.min(...targets.map((element) => element.y));
      targets.forEach((element) => { element.y = ref; touchElement(element); });
      break;
    case 'middle': {
      const minY = Math.min(...targets.map((element) => element.y));
      const maxY = Math.max(...targets.map((element) => element.y + element.height));
      ref = (minY + maxY) / 2;
      targets.forEach((element) => { element.y = ref - element.height / 2; touchElement(element); });
      break;
    }
    case 'bottom':
      ref = Math.max(...targets.map((element) => element.y + element.height));
      targets.forEach((element) => { element.y = ref - element.height; touchElement(element); });
      break;
  }
}

function applyDistribution(elements: Element[], ids: string[], direction: 'horizontal' | 'vertical') {
  const targets = elements.filter((element) => ids.includes(element.id));
  if (targets.length < 3) return;

  if (direction === 'horizontal') {
    targets.sort((left, right) => left.x - right.x);
    const totalWidth = targets.reduce((sum, element) => sum + element.width, 0);
    const minX = targets[0].x;
    const maxX = targets[targets.length - 1].x + targets[targets.length - 1].width;
    const gap = (maxX - minX - totalWidth) / (targets.length - 1);
    let currentX = minX;
    for (const element of targets) {
      element.x = currentX;
      touchElement(element);
      currentX += element.width + gap;
    }
  } else {
    targets.sort((left, right) => left.y - right.y);
    const totalHeight = targets.reduce((sum, element) => sum + element.height, 0);
    const minY = targets[0].y;
    const maxY = targets[targets.length - 1].y + targets[targets.length - 1].height;
    const gap = (maxY - minY - totalHeight) / (targets.length - 1);
    let currentY = minY;
    for (const element of targets) {
      element.y = currentY;
      touchElement(element);
      currentY += element.height + gap;
    }
  }
}

function applyGrouping(elements: Element[], ids: string[]) {
  const groupId = crypto.randomUUID?.() ?? `group_${Date.now()}`;
  for (const element of elements) {
    if (ids.includes(element.id) && !element.groupIds.includes(groupId)) {
      element.groupIds = [...element.groupIds, groupId];
      touchElement(element);
    }
  }
}

function applyUngrouping(elements: Element[], ids: string[]) {
  const groupIdsToRemove = new Set<string>();
  for (const element of elements) {
    if (ids.includes(element.id) && element.groupIds.length > 0) {
      groupIdsToRemove.add(element.groupIds[element.groupIds.length - 1]);
    }
  }
  for (const element of elements) {
    const nextGroupIds = element.groupIds.filter((groupId) => !groupIdsToRemove.has(groupId));
    if (nextGroupIds.length !== element.groupIds.length) {
      element.groupIds = nextGroupIds;
      touchElement(element);
    }
  }
}

function executeOperation(
  draft: DocumentTransactionDraft,
  refMap: Map<string, string>,
  operation: AIOperation,
  touchedIds: Set<string>,
) {
  switch (operation.op) {
    case 'add_element': {
      const element = createElementFromOperation(operation);
      registerReference(refMap, operation.ref, element.id);
      draft.elements.push(element);
      touchedIds.add(element.id);
      return;
    }
    case 'update_element': {
      const element = resolveMutableElement(draft, refMap, operation.target);
      applyElementPatch(element, operation.changes);
      touchedIds.add(element.id);
      return;
    }
    case 'delete_elements':
      applyDelete(draft, refMap, operation.targets, touchedIds);
      return;
    case 'move_elements': {
      const elements = resolveReferenceElements(draft.elements, refMap, operation.targets);
      for (const element of elements) {
        element.x += operation.dx;
        element.y += operation.dy;
        touchElement(element);
        touchedIds.add(element.id);
      }
      return;
    }
    case 'connect_elements': {
      const from = resolveReferenceElement(draft.elements, refMap, operation.from);
      const to = resolveReferenceElement(draft.elements, refMap, operation.to);
      const connector = createConnectionElement(operation, from, to);
      draft.elements.push(connector);
      touchedIds.add(connector.id);
      return;
    }
    case 'align_elements': {
      const ids = operation.targets.map((reference) => resolveReferenceId(refMap, reference));
      applyAlignment(draft.elements, ids, operation.alignment);
      ids.forEach((id) => touchedIds.add(id));
      return;
    }
    case 'distribute_elements': {
      const ids = operation.targets.map((reference) => resolveReferenceId(refMap, reference));
      applyDistribution(draft.elements, ids, operation.direction);
      ids.forEach((id) => touchedIds.add(id));
      return;
    }
    case 'group_elements': {
      const ids = operation.targets.map((reference) => resolveReferenceId(refMap, reference));
      applyGrouping(draft.elements, ids);
      ids.forEach((id) => touchedIds.add(id));
      return;
    }
    case 'ungroup_elements': {
      const ids = operation.targets.map((reference) => resolveReferenceId(refMap, reference));
      applyUngrouping(draft.elements, ids);
      ids.forEach((id) => touchedIds.add(id));
      return;
    }
    case 'reorder_elements': {
      const ids = operation.targets.map((reference) => resolveReferenceId(refMap, reference));
      draft.elements = applyReorder(draft.elements, ids, operation.action);
      ids.forEach((id) => touchedIds.add(id));
      return;
    }
    case 'mindmap_add_child': {
      const element = resolveMutableElement(draft, refMap, operation.target);
      if (element.type !== 'mindmap') {
        throw new Error(`Target "${element.id}" is not a mindmap.`);
      }
      if (!findMindmapNode(element.rootNode, operation.parentNodeId)) {
        throw new Error(`Mindmap node "${operation.parentNodeId}" not found.`);
      }
      element.rootNode = addMindmapChild(element.rootNode, operation.parentNodeId, createMindmapNode(operation.node, 'leaf'));
      touchElement(element);
      touchedIds.add(element.id);
      return;
    }
    case 'mindmap_add_sibling': {
      const element = resolveMutableElement(draft, refMap, operation.target);
      if (element.type !== 'mindmap') {
        throw new Error(`Target "${element.id}" is not a mindmap.`);
      }
      if (!findMindmapNode(element.rootNode, operation.siblingNodeId)) {
        throw new Error(`Mindmap node "${operation.siblingNodeId}" not found.`);
      }
      element.rootNode = addMindmapSibling(element.rootNode, operation.siblingNodeId, createMindmapNode(operation.node, 'branch'));
      touchElement(element);
      touchedIds.add(element.id);
      return;
    }
    case 'mindmap_update_node': {
      const element = resolveMutableElement(draft, refMap, operation.target);
      if (element.type !== 'mindmap') {
        throw new Error(`Target "${element.id}" is not a mindmap.`);
      }
      if (!findMindmapNode(element.rootNode, operation.nodeId)) {
        throw new Error(`Mindmap node "${operation.nodeId}" not found.`);
      }
      element.rootNode = updateMindmapNode(element.rootNode, operation.nodeId, operation.changes);
      touchElement(element);
      touchedIds.add(element.id);
      return;
    }
    case 'mindmap_move_node': {
      const element = resolveMutableElement(draft, refMap, operation.target);
      if (element.type !== 'mindmap') {
        throw new Error(`Target "${element.id}" is not a mindmap.`);
      }
      if (!findMindmapNode(element.rootNode, operation.nodeId)) {
        throw new Error(`Mindmap node "${operation.nodeId}" not found.`);
      }
      if (!findMindmapNode(element.rootNode, operation.nextParentNodeId)) {
        throw new Error(`Mindmap node "${operation.nextParentNodeId}" not found.`);
      }
      element.rootNode = moveMindmapNode(element.rootNode, operation.nodeId, operation.nextParentNodeId);
      touchElement(element);
      touchedIds.add(element.id);
      return;
    }
  }
}

export function executeOperationPlan(plan: AIOperationPlan): AIOperationExecutionResult {
  const store = useDocumentStore.getState();
  const draft: DocumentTransactionDraft = {
    elements: structuredClone(store.elements),
    appState: structuredClone(store.appState),
    files: structuredClone(store.files),
  };
  const refMap = new Map<string, string>();
  const touchedIds = new Set<string>();

  for (const operation of plan.operations) {
    executeOperation(draft, refMap, operation, touchedIds);
  }

  useDocumentStore.getState().applyTransaction((state) => {
    state.elements = draft.elements;
    state.appState = draft.appState;
    state.files = draft.files;
  }, { pushHistory: true, markDirty: true });

  return {
    summary: plan.summary,
    intent: plan.intent,
    operationsApplied: plan.operations.length,
    touchedElementIds: [...touchedIds],
  };
}

export function executeOperationPlanFromRaw(raw: string): AIOperationExecutionResult {
  const parsed = parseOperationPlan(raw);
  if (!parsed.success) {
    const issue = parsed.issues[0];
    throw new Error(issue ? `${issue.path}: ${issue.message}` : 'Invalid AI operation plan.');
  }
  return executeOperationPlan(parsed.value);
}
