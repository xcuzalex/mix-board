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
import {
  type Rect,
  type MeasureNode,
  childrenOf,
  layoutMindmapNodes,
  mindmapNodeFont,
  visibleChildrenOf,
} from './mindmap-layout';
import { canvasTheme } from '../canvas-theme';

// --- Branch styling ---------------------------------------------------------
// Each first-level branch (and its whole subtree) gets one color from this
// palette, used for its connectors, card border/tint and count badges.
const BRANCH_PALETTE = ['#2D6EA6', '#B5651D', '#6B4FBB', '#2E7D4F', '#A23B5E', '#1F8A8A', '#A97A10', '#5B6B8C'];

// Creation defaults. Nodes / lines still on these follow the automatic branch
// palette; anything the user explicitly recolored is respected as-is.
const DEFAULT_ROOT_BG = '#2F6B55';
const DEFAULT_NODE_BG = '#E7F5EE';
const DEFAULT_NODE_TEXT = '#234032';
const DEFAULT_LINE = '#7AA692';
const ROOT_FILL = '#1E3A32';

const isAutoColor = (value: string | undefined, fallback: string) =>
  !value || value.toLowerCase() === fallback.toLowerCase();

const branchColorCache = new WeakMap<MindmapNode, Map<string, string>>();

/**
 * node id -> branch color (root tree objects are immutable, so cache by identity).
 * Colors follow `childrenOf(root)` order, which for the auto-split 左右 layout is
 * the clockwise order around the root (see getMindmapSides), so neighbouring
 * branches keep distinct colors on both sides.
 */
function getBranchColors(root: MindmapNode): Map<string, string> {
  const cached = branchColorCache.get(root);
  if (cached) return cached;
  const colors = new Map<string, string>();
  const paint = (node: MindmapNode, color: string) => {
    colors.set(node.id, color);
    for (const child of childrenOf(node)) paint(child, color);
  };
  childrenOf(root).forEach((child, i) => paint(child, BRANCH_PALETTE[i % BRANCH_PALETTE.length]));
  branchColorCache.set(root, colors);
  return colors;
}

const descendantCountCache = new WeakMap<MindmapNode, number>();

/** Number of topics under a node (collapsed ones included), cached by node identity. */
function countDescendants(node: MindmapNode): number {
  const cached = descendantCountCache.get(node);
  if (cached !== undefined) return cached;
  let count = 0;
  for (const child of childrenOf(node)) count += 1 + countDescendants(child);
  descendantCountCache.set(node, count);
  return count;
}

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type MindmapNodeRef = { elementId: string; nodeId: string };

export interface MindmapDrawDeps {
  ctx: CanvasRenderingContext2D;
  /** viewport.zoom, snapshotted for the render pass. */
  zoom: number;
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

  const style = el.lineStyle || { color: DEFAULT_LINE, width: 2.5, style: 'solid' as const };
  const autoLine = isAutoColor(style.color, DEFAULT_LINE);
  const branchColors = getBranchColors(el.rootNode);
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

  const allChildren = visibleChildrenOf(node).filter((child) => !isDragged(deps, el.id, child.id));

  for (const child of allChildren) {
    ctx.strokeStyle = autoLine ? (branchColors.get(child.id) ?? style.color) : style.color;
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

  const isRoot = node.id === el.rootNode.id;
  const branchColor = getBranchColors(el.rootNode).get(node.id) ?? BRANCH_PALETTE[0];
  const autoFill = isRoot
    ? isAutoColor(node.backgroundColor, DEFAULT_ROOT_BG)
    : isAutoColor(node.backgroundColor, DEFAULT_NODE_BG);

  if (node.nodeShape !== 'text') {
    ctx.save();
    const radius = node.nodeShape === 'pill' ? h / 2 : isRoot ? 12 : 10;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    if (isRoot) {
      // Dark, solid root card.
      ctx.shadowColor = 'rgba(15, 23, 42, 0.18)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = autoFill ? ROOT_FILL : node.backgroundColor;
      ctx.fill();
    } else if (autoFill) {
      // Branch card: opaque base + light tint of the branch color + colored border.
      ctx.fillStyle = canvasTheme.background;
      ctx.fill();
      ctx.fillStyle = withAlpha(branchColor, 0.12);
      ctx.fill();
      ctx.strokeStyle = branchColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // User-chosen colors.
      ctx.fillStyle = node.backgroundColor;
      ctx.fill();
      ctx.strokeStyle = node.backgroundColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  if (deps.editingMindmapNodeId !== node.id) {
    const autoText = isRoot
      ? !node.textColor || node.textColor.toLowerCase() === '#ffffff'
      : isAutoColor(node.textColor, DEFAULT_NODE_TEXT);
    ctx.fillStyle = isRoot
      ? (autoText && node.nodeShape !== 'text' ? '#FFFFFF' : node.textColor || canvasTheme.foreground)
      : (autoText ? canvasTheme.foreground : node.textColor);
    ctx.font = mindmapNodeFont(node);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.text || '主题', x + w / 2, y + h / 2, w - 8);
  }

  // Count badge on the outer edge: how many topics sit under this node.
  // Solid when collapsed (children hidden), outlined when expanded.
  const descendants = isRoot ? 0 : countDescendants(node);
  if (descendants > 0) {
    const rootRect = layout.get(el.rootNode.id);
    const isDown = el.layout === 'tree_down';
    const onLeft = !isDown && !!rootRect && x + w / 2 < rootRect.x + rootRect.w / 2;
    const bx = isDown ? x + w / 2 : onLeft ? x : x + w;
    const by = isDown ? y + h : y + h / 2;
    const color = autoFill ? branchColor : '#8B8FA3';
    const label = String(descendants);
    ctx.save();
    ctx.font = '700 10px Inter, system-ui, sans-serif';
    const r = Math.max(9, ctx.measureText(label).width / 2 + 4);
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = node.collapsed ? color : canvasTheme.background;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = node.collapsed ? '#FFFFFF' : color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx, by + 0.5);
    ctx.restore();
  }

  for (const child of visibleChildrenOf(node)) {
    if (isDragged(deps, el.id, child.id)) continue;
    drawMindmapNode(deps, el, child, layout);
  }
}

/**
 * Interactive chrome for one mindmap, drawn on the overlay layer on top of the
 * scene-layer mindmap: the selected-node ring and the drag drop-target ring.
 * Only the rings are drawn (not the whole tree), so element opacity is never
 * composited twice.
 */
export function drawMindmapChrome(deps: MindmapDrawDeps, el: MindmapElement, layout: Map<string, Rect>) {
  if (!el.rootNode) return;
  const ctx = deps.ctx;

  const selected = deps.selectedMindmapNode;
  if (selected?.elementId === el.id && deps.editingMindmapNodeId !== selected.nodeId) {
    const node = findMindmapNode(el.rootNode, selected.nodeId);
    const rect = node ? layout.get(node.id) : undefined;
    if (node && rect) {
      const { x, y, w, h } = rect;
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
  }

  const dropTarget = deps.mindmapDropTarget;
  if (dropTarget?.elementId === el.id) {
    const node = findMindmapNode(el.rootNode, dropTarget.nodeId);
    const rect = node ? layout.get(node.id) : undefined;
    if (node && rect) {
      const { x, y, w, h } = rect;
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
  for (const child of childrenOf(root)) {
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

  for (const child of visibleChildrenOf(node)) {
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

  for (const child of visibleChildrenOf(node)) {
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
