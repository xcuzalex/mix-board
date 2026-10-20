/**
 * Mindmap drawing — nodes, connections, collapse indicators, and the drag
 * ghost/preview. Extracted from renderer.ts (P0.B). The layout algorithm lives
 * in ./mindmap-layout; this module is the 2D-canvas drawing of a computed
 * layout, plus the tree-preview math used while dragging a node.
 *
 * All live state (ctx, viewport zoom, selection / drop-target / editing /
 * drag-preview flags, scene index, and the cache-backed layout + measure) is
 * threaded in via MindmapDrawDeps, so these functions hold no state of their own.
 */
import type { Element, MindmapElement, MindmapNode } from '../../types/element';
import { THEME } from '../../utils/color';
import type { SceneIndex } from '../linear';
import { type Rect, type MeasureNode, layoutMindmapNodes } from './mindmap-layout';

type MindmapNodeRef = { elementId: string; nodeId: string };

export interface MindmapDrawDeps {
  ctx: CanvasRenderingContext2D;
  /** viewport.zoom, snapshotted for the render pass. */
  zoom: number;
  interactiveChrome: boolean;
  selectedMindmapNode: MindmapNodeRef | null;
  mindmapDropTarget: MindmapNodeRef | null;
  editingMindmapNodeId: string | null;
  mindmapDragPreview: { elementId: string; sourceNodeId: string } | null;
  sceneIndex: SceneIndex;
  getMindmapLayout: (el: MindmapElement) => Map<string, Rect>;
  measureMindmapNode: MeasureNode;
}

function isDragged(deps: MindmapDrawDeps, elementId: string, nodeId: string): boolean {
  return deps.mindmapDragPreview?.elementId === elementId
    && deps.mindmapDragPreview.sourceNodeId === nodeId;
}

function getNodeRect(layout: Map<string, Rect>, node: MindmapNode, fallbackX: number, fallbackY: number): Rect {
  const cached = layout.get(node.id);
  return cached ?? { x: fallbackX, y: fallbackY, w: 60, h: 30 };
}

function getShiftedNodeRect(layout: Map<string, Rect>, node: MindmapNode, fallbackX: number, fallbackY: number, dx: number, dy: number): Rect {
  const rect = getNodeRect(layout, node, fallbackX, fallbackY);
  return { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
}

/** Draws a mindmap: connections first, then nodes, both recursively from the root. */
export function drawMindmap(deps: MindmapDrawDeps, el: MindmapElement, layout: Map<string, Rect>) {
  if (!el.rootNode) return;
  drawMindmapConnections(deps, el, el.rootNode, layout);
  drawMindmapNode(deps, el, el.rootNode, layout);
}

function drawMindmapConnections(deps: MindmapDrawDeps, el: MindmapElement, node: MindmapNode, layout: Map<string, Rect>) {
  if (isDragged(deps, el.id, node.id)) return;
  const ctx = deps.ctx;
  const nr = getNodeRect(layout, node, el.x, el.y);

  const style = el.lineStyle || { color: '#8B8FA3', width: 2, style: 'solid' as const };
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (style.style === 'dashed') {
    ctx.setLineDash([6, 4]);
  } else if (style.style === 'dotted') {
    ctx.setLineDash([2, 4]);
  } else {
    ctx.setLineDash([]);
  }

  const allChildren = [
    ...(node.collapsed ? [] : node.children),
    ...(node.collapsed ? [] : (node.leftChildren || [])),
    ...(node.collapsed ? [] : (node.rightChildren || [])),
  ].filter((child) => !isDragged(deps, el.id, child.id));

  for (const child of allChildren) {
    const cr = getNodeRect(layout, child, 0, 0);
    const isLeft = cr.x + cr.w < nr.x;
    const isDown = el.layout === 'tree_down';

    ctx.beginPath();
    if (el.branchStyle === 'polyline' || isDown) {
      if (isDown) {
        const fromX = nr.x + nr.w / 2, fromY = nr.y + nr.h;
        const toX = cr.x + cr.w / 2, toY = cr.y;
        const midY = (fromY + toY) / 2;
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(fromX, midY);
        ctx.lineTo(toX, midY);
        ctx.lineTo(toX, toY);
      } else {
        const fromX = isLeft ? nr.x : nr.x + nr.w;
        const fromY = nr.y + nr.h / 2;
        const toX = isLeft ? cr.x + cr.w : cr.x;
        const toY = cr.y + cr.h / 2;
        const midX = (fromX + toX) / 2;
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(midX, fromY);
        ctx.lineTo(midX, toY);
        ctx.lineTo(toX, toY);
      }
    } else {
      const fromX = isLeft ? nr.x : nr.x + nr.w;
      const fromY = nr.y + nr.h / 2;
      const toX = isLeft ? cr.x + cr.w : cr.x;
      const toY = cr.y + cr.h / 2;
      const cpOffset = Math.abs(toX - fromX) * 0.5;
      ctx.moveTo(fromX, fromY);
      ctx.bezierCurveTo(
        fromX + (isLeft ? -cpOffset : cpOffset), fromY,
        toX + (isLeft ? cpOffset : -cpOffset), toY,
        toX, toY,
      );
    }
    ctx.stroke();
    drawMindmapConnections(deps, el, child, layout);
  }
  ctx.setLineDash([]);
}

function drawMindmapNode(deps: MindmapDrawDeps, el: MindmapElement, node: MindmapNode, layout: Map<string, Rect>) {
  if (isDragged(deps, el.id, node.id)) return;
  const ctx = deps.ctx;
  const { x, y, w, h } = getNodeRect(layout, node, el.x, el.y);
  const isSelectedNode = deps.interactiveChrome
    && deps.selectedMindmapNode?.elementId === el.id
    && deps.selectedMindmapNode.nodeId === node.id
    && deps.editingMindmapNodeId !== node.id;
  const isDropTargetNode = deps.interactiveChrome
    && deps.mindmapDropTarget?.elementId === el.id
    && deps.mindmapDropTarget.nodeId === node.id;

  if (node.nodeShape !== 'text') {
    ctx.save();
    ctx.shadowColor = node.nodeType === 'root' ? 'rgba(47, 107, 85, 0.18)' : 'rgba(15, 23, 42, 0.08)';
    ctx.shadowBlur = node.nodeType === 'root' ? 18 : 10;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    const radius = node.nodeShape === 'pill' ? h / 2 : 6;
    ctx.roundRect(x, y, w, h, radius);
    ctx.fillStyle = node.backgroundColor || (node.nodeType === 'root' ? '#3370FF' : '#E3EAFD');
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = node.nodeType === 'root' ? 'rgba(0, 0, 0, 0.04)' : (node.backgroundColor || '#3370FF');
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  if (deps.editingMindmapNodeId !== node.id) {
    ctx.fillStyle = node.textColor || (node.nodeType === 'root' && node.nodeShape !== 'text' ? '#FFFFFF' : '#1B1B1F');
    ctx.font = `${node.fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.text || '主题', x + w / 2, y + h / 2, w - 8);
  }

  if (isSelectedNode) {
    ctx.save();
    ctx.beginPath();
    if (node.nodeShape === 'text') {
      ctx.roundRect(x - 4, y - 4, w + 8, h + 8, 8);
    } else {
      const radius = node.nodeShape === 'pill' ? h / 2 + 4 : 10;
      ctx.roundRect(x - 4, y - 4, w + 8, h + 8, radius);
    }
    ctx.strokeStyle = THEME.selected;
    ctx.lineWidth = 2 / deps.zoom;
    ctx.stroke();
    ctx.restore();
  }

  if (isDropTargetNode) {
    ctx.save();
    ctx.beginPath();
    if (node.nodeShape === 'text') {
      ctx.roundRect(x - 6, y - 6, w + 12, h + 12, 10);
    } else {
      const radius = node.nodeShape === 'pill' ? (h + 12) / 2 : 12;
      ctx.roundRect(x - 6, y - 6, w + 12, h + 12, radius);
    }
    ctx.strokeStyle = '#16A34A';
    ctx.lineWidth = 2 / deps.zoom;
    ctx.setLineDash([6 / deps.zoom, 4 / deps.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Collapse indicator
  const allChildCount = node.children.length + (node.leftChildren?.length || 0) + (node.rightChildren?.length || 0);
  if (allChildCount > 0 && node.collapsed) {
    const ix = x + w + 4;
    const iy = y + h / 2;
    ctx.fillStyle = '#8B8FA3';
    ctx.beginPath();
    ctx.arc(ix, iy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.fillText('+', ix, iy + 1);
  }

  const allChildren = [
    ...(node.collapsed ? [] : node.children),
    ...(node.collapsed ? [] : (node.leftChildren || [])),
    ...(node.collapsed ? [] : (node.rightChildren || [])),
  ].filter((child) => !isDragged(deps, el.id, child.id));
  for (const child of allChildren) {
    drawMindmapNode(deps, el, child, layout);
  }
}

// --- Drag-preview tree math (pure) ---

function cloneMindmapNode(node: MindmapNode): MindmapNode {
  return {
    ...node,
    children: node.children.map((child) => cloneMindmapNode(child)),
    leftChildren: (node.leftChildren || []).map((child) => cloneMindmapNode(child)),
    rightChildren: (node.rightChildren || []).map((child) => cloneMindmapNode(child)),
  };
}

function addMindmapChildPreview(root: MindmapNode, parentId: string, node: MindmapNode): MindmapNode {
  if (root.id === parentId) {
    return {
      ...root,
      collapsed: false,
      children: [...root.children, node],
    };
  }

  return {
    ...root,
    children: root.children.map((child) => addMindmapChildPreview(child, parentId, node)),
    leftChildren: (root.leftChildren || []).map((child) => addMindmapChildPreview(child, parentId, node)),
    rightChildren: (root.rightChildren || []).map((child) => addMindmapChildPreview(child, parentId, node)),
  };
}

function extractMindmapNodePreview(root: MindmapNode, nodeId: string): { root: MindmapNode; extracted: MindmapNode | null } {
  const extractFromList = (nodes: MindmapNode[]): { nodes: MindmapNode[]; extracted: MindmapNode | null } => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.id === nodeId) {
        return { nodes: [...nodes.slice(0, index), ...nodes.slice(index + 1)], extracted: node };
      }

      const nextChildren = extractFromList(node.children);
      if (nextChildren.extracted) {
        return {
          nodes: [
            ...nodes.slice(0, index),
            { ...node, children: nextChildren.nodes },
            ...nodes.slice(index + 1),
          ],
          extracted: nextChildren.extracted,
        };
      }

      const nextLeftChildren = extractFromList(node.leftChildren || []);
      if (nextLeftChildren.extracted) {
        return {
          nodes: [
            ...nodes.slice(0, index),
            { ...node, leftChildren: nextLeftChildren.nodes },
            ...nodes.slice(index + 1),
          ],
          extracted: nextLeftChildren.extracted,
        };
      }

      const nextRightChildren = extractFromList(node.rightChildren || []);
      if (nextRightChildren.extracted) {
        return {
          nodes: [
            ...nodes.slice(0, index),
            { ...node, rightChildren: nextRightChildren.nodes },
            ...nodes.slice(index + 1),
          ],
          extracted: nextRightChildren.extracted,
        };
      }
    }

    return { nodes, extracted: null };
  };

  if (root.id === nodeId) {
    return { root, extracted: null };
  }

  const nextChildren = extractFromList(root.children);
  if (nextChildren.extracted) {
    return { root: { ...root, children: nextChildren.nodes }, extracted: nextChildren.extracted };
  }

  const nextLeftChildren = extractFromList(root.leftChildren || []);
  if (nextLeftChildren.extracted) {
    return { root: { ...root, leftChildren: nextLeftChildren.nodes }, extracted: nextLeftChildren.extracted };
  }

  const nextRightChildren = extractFromList(root.rightChildren || []);
  if (nextRightChildren.extracted) {
    return { root: { ...root, rightChildren: nextRightChildren.nodes }, extracted: nextRightChildren.extracted };
  }

  return { root, extracted: null };
}

function findMindmapNode(root: MindmapNode, nodeId: string): MindmapNode | null {
  if (root.id === nodeId) return root;
  const allChildren = [...root.children, ...(root.leftChildren || []), ...(root.rightChildren || [])];
  for (const child of allChildren) {
    const found = findMindmapNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

function moveMindmapNodePreview(root: MindmapNode, nodeId: string, targetParentId: string): MindmapNode {
  if (root.id === nodeId || nodeId === targetParentId) return root;

  const draggedNode = findMindmapNode(root, nodeId);
  if (!draggedNode || findMindmapNode(draggedNode, targetParentId)) {
    return root;
  }

  const clonedRoot = cloneMindmapNode(root);
  const { root: withoutNode, extracted } = extractMindmapNodePreview(clonedRoot, nodeId);
  if (!extracted) return root;

  return addMindmapChildPreview(withoutNode, targetParentId, extracted);
}

function getProjectedMindmapNodeRect(deps: MindmapDrawDeps, el: MindmapElement, sourceNodeId: string, targetNodeId: string): Rect | null {
  const projectedRoot = moveMindmapNodePreview(el.rootNode, sourceNodeId, targetNodeId);
  if (projectedRoot === el.rootNode) return null;

  const projectedElement = { ...el, rootNode: projectedRoot };
  const layout = layoutMindmapNodes(projectedElement, deps.measureMindmapNode);
  return layout.get(sourceNodeId) ?? null;
}

// --- Drag ghost drawing ---

function drawMindmapGhostConnections(deps: MindmapDrawDeps, el: MindmapElement, node: MindmapNode, layout: Map<string, Rect>, dx: number, dy: number) {
  const ctx = deps.ctx;
  const nr = getShiftedNodeRect(layout, node, el.x, el.y, dx, dy);

  const style = el.lineStyle || { color: '#8B8FA3', width: 2, style: 'solid' as const };
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  const allChildren = [
    ...(node.collapsed ? [] : node.children),
    ...(node.collapsed ? [] : (node.leftChildren || [])),
    ...(node.collapsed ? [] : (node.rightChildren || [])),
  ];

  for (const child of allChildren) {
    const cr = getShiftedNodeRect(layout, child, 0, 0, dx, dy);
    const isLeft = cr.x + cr.w < nr.x;

    ctx.beginPath();
    const fromX = isLeft ? nr.x : nr.x + nr.w;
    const fromY = nr.y + nr.h / 2;
    const toX = isLeft ? cr.x + cr.w : cr.x;
    const toY = cr.y + cr.h / 2;
    const cpOffset = Math.abs(toX - fromX) * 0.5;
    ctx.moveTo(fromX, fromY);
    ctx.bezierCurveTo(
      fromX + (isLeft ? -cpOffset : cpOffset), fromY,
      toX + (isLeft ? cpOffset : -cpOffset), toY,
      toX, toY,
    );
    ctx.stroke();
    drawMindmapGhostConnections(deps, el, child, layout, dx, dy);
  }
}

function drawMindmapGhostNode(deps: MindmapDrawDeps, node: MindmapNode, x: number, y: number, w: number, h: number) {
  const ctx = deps.ctx;

  if (node.nodeShape !== 'text') {
    ctx.save();
    ctx.shadowColor = 'rgba(15, 23, 42, 0.14)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.beginPath();
    const radius = node.nodeShape === 'pill' ? h / 2 : 6;
    ctx.roundRect(x, y, w, h, radius);
    ctx.fillStyle = node.backgroundColor || (node.nodeType === 'root' ? '#3370FF' : '#E3EAFD');
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = 1.5 / deps.zoom;
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = node.textColor || (node.nodeType === 'root' && node.nodeShape !== 'text' ? '#FFFFFF' : '#1B1B1F');
  ctx.font = `${node.fontSize}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(node.text || '主题', x + w / 2, y + h / 2, w - 8);
}

function drawMindmapGhostSubtree(deps: MindmapDrawDeps, el: MindmapElement, node: MindmapNode, layout: Map<string, Rect>, dx: number, dy: number) {
  const { x, y, w, h } = getShiftedNodeRect(layout, node, el.x, el.y, dx, dy);
  drawMindmapGhostNode(deps, node, x, y, w, h);

  const allChildren = [
    ...(node.collapsed ? [] : node.children),
    ...(node.collapsed ? [] : (node.leftChildren || [])),
    ...(node.collapsed ? [] : (node.rightChildren || [])),
  ];

  for (const child of allChildren) {
    drawMindmapGhostSubtree(deps, el, child, layout, dx, dy);
  }
}

export function renderMindmapDragPreview(
  deps: MindmapDrawDeps,
  preview: { elementId: string; sourceNodeId: string; pointerX: number; pointerY: number; offsetX: number; offsetY: number },
) {
  const element = deps.sceneIndex.byId.get(preview.elementId) as Element | undefined;
  if (!element || element.type !== 'mindmap') return;

  const layout = deps.getMindmapLayout(element as MindmapElement);

  const sourceNode = findMindmapNode((element as MindmapElement).rootNode, preview.sourceNodeId);
  const sourceRect = layout.get(preview.sourceNodeId);
  if (!sourceNode || !sourceRect) return;

  const projectedRect = deps.mindmapDropTarget?.elementId === preview.elementId
    ? getProjectedMindmapNodeRect(deps, element as MindmapElement, preview.sourceNodeId, deps.mindmapDropTarget.nodeId)
    : null;

  const dx = projectedRect ? projectedRect.x - sourceRect.x : preview.offsetX;
  const dy = projectedRect ? projectedRect.y - sourceRect.y : preview.offsetY;

  const fromX = sourceRect.x + sourceRect.w / 2;
  const fromY = sourceRect.y + sourceRect.h / 2;
  const toX = projectedRect ? projectedRect.x + projectedRect.w / 2 : preview.pointerX;
  const toY = projectedRect ? projectedRect.y + projectedRect.h / 2 : preview.pointerY;
  const curveOffset = Math.max(Math.abs(toX - fromX) * 0.35, 24);

  const ctx = deps.ctx;
  ctx.save();
  ctx.globalAlpha = 0.92;
  drawMindmapGhostConnections(deps, element as MindmapElement, sourceNode, layout, dx, dy);
  drawMindmapGhostSubtree(deps, element as MindmapElement, sourceNode, layout, dx, dy);
  if (!projectedRect) {
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.bezierCurveTo(fromX + curveOffset, fromY, toX - curveOffset, toY, toX, toY);
    ctx.strokeStyle = '#16A34A';
    ctx.lineWidth = 2 / deps.zoom;
    ctx.setLineDash([8 / deps.zoom, 5 / deps.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
