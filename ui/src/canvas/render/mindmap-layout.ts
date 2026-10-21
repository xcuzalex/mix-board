/**
 * Mindmap layout engine — the pure tree layout algorithm. Extracted from
 * renderer.ts (P0.B). No canvas/ctx here: node measurement is injected as
 * `measure`, so this module is pure geometry and is the piece reused by the
 * outline <-> mindmap work (P2).
 *
 * The Renderer still owns layout caching (keyed by root-node identity, with a
 * shift when the element moves) and the ctx-backed `measure` implementation; it
 * calls these functions.
 */
import type { MindmapElement, MindmapNode } from '../../types/element';

export type Rect = { x: number; y: number; w: number; h: number };

/** Measures a node's rendered box. Injected by the Renderer (ctx.measureText + cache). */
export type MeasureNode = (node: MindmapNode) => { w: number; h: number };

const MINDMAP_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/** Font used to draw (and measure) a mindmap node's title. */
export function mindmapNodeFont(node: MindmapNode): string {
  return `${node.nodeType === 'root' ? 700 : 600} ${node.fontSize}px ${MINDMAP_FONT_FAMILY}`;
}

/** Node box size for a given 2D context (shared by the renderer and UI fit-to-screen). */
export function measureMindmapNodeWith(ctx: CanvasRenderingContext2D, node: MindmapNode): { w: number; h: number } {
  ctx.font = mindmapNodeFont(node);
  const textWidth = ctx.measureText(node.text || '主题').width;
  const isText = node.nodeShape === 'text';
  const padding = isText ? 8 : 22;
  return {
    w: Math.max(textWidth + padding * 2, 64),
    h: node.fontSize * 1.5 + (isText ? 4 : 18),
  };
}

/** Bounding box of a computed layout. */
export function getLayoutBounds(layout: Map<string, Rect>): { x: number; y: number; width: number; height: number } | null {
  if (layout.size === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of layout.values()) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Every child list of a node (main + explicit left/right sides), ignoring collapse. */
export function childrenOf(node: MindmapNode): MindmapNode[] {
  const left = node.leftChildren ?? [];
  const right = node.rightChildren ?? [];
  if (left.length === 0 && right.length === 0) return node.children;
  return [...node.children, ...left, ...right];
}

/** Children that are laid out and drawn: none while the node is collapsed. */
export function visibleChildrenOf(node: MindmapNode): MindmapNode[] {
  return node.collapsed ? [] : childrenOf(node);
}

/**
 * Root branches for the two-sided (`mindmap_lr`, 左右) layout, each side listed
 * top to bottom. Explicit `rightChildren` / `leftChildren` win when either is
 * set; otherwise (the app only ever fills `root.children`) the children are
 * split clockwise like XMind: the first half (rounded up) runs down the right
 * side and the rest continue up the left side. Reading order therefore goes
 * around the root, and appending a child only ever moves the bottom-most branch
 * across sides.
 */
export function getMindmapSides(root: MindmapNode): { right: MindmapNode[]; left: MindmapNode[] } {
  const explicitRight = root.rightChildren ?? [];
  const explicitLeft = root.leftChildren ?? [];
  if (explicitRight.length > 0 || explicitLeft.length > 0) {
    return {
      right: explicitRight.length > 0 ? explicitRight : root.children,
      left: explicitLeft,
    };
  }
  const children = root.children;
  const split = Math.ceil(children.length / 2);
  return {
    right: children.slice(0, split),
    left: children.slice(split).reverse(),
  };
}

/** Computes absolute rects for every node, honoring the element's layout direction. */
export function layoutMindmapNodes(el: MindmapElement, measure: MeasureNode): Map<string, Rect> {
  const hGap = 60;
  const vGap = 20;
  const root = el.rootNode;
  const layout = new Map<string, Rect>();
  // Per-layout memos: subtree extents would otherwise be recomputed at every level.
  const sizeMemo = new Map<string, { w: number; h: number }>();
  const heightMemo = new Map<string, number>();
  const widthMemo = new Map<string, number>();

  const sizeOf = (node: MindmapNode) => {
    let size = sizeMemo.get(node.id);
    if (!size) {
      size = measure(node);
      sizeMemo.set(node.id, size);
    }
    return size;
  };

  /** Height of a subtree whose children stack vertically (left / right layouts). */
  const getSubtreeHeight = (node: MindmapNode): number => {
    const memo = heightMemo.get(node.id);
    if (memo !== undefined) return memo;
    const children = node.collapsed ? [] : node.children;
    const size = sizeOf(node);
    let result = size.h;
    if (children.length > 0) {
      let total = 0;
      for (const child of children) total += getSubtreeHeight(child);
      total += (children.length - 1) * vGap;
      result = Math.max(size.h, total);
    }
    heightMemo.set(node.id, result);
    return result;
  };

  /** Width of a subtree whose children spread horizontally (tree_down). */
  const getSubtreeWidth = (node: MindmapNode): number => {
    const memo = widthMemo.get(node.id);
    if (memo !== undefined) return memo;
    const children = node.collapsed ? [] : node.children;
    const size = sizeOf(node);
    let result = size.w;
    if (children.length > 0) {
      let total = 0;
      for (const child of children) total += getSubtreeWidth(child);
      total += (children.length - 1) * hGap;
      result = Math.max(size.w, total);
    }
    widthMemo.set(node.id, result);
    return result;
  };

  const layoutTree = (
    node: MindmapNode,
    x: number,
    y: number,
    direction: 'right' | 'left' | 'down',
  ) => {
    const size = sizeOf(node);
    layout.set(node.id, { x, y, w: size.w, h: size.h });

    const children = node.collapsed ? [] : node.children;
    if (children.length === 0) return;

    if (direction === 'down') {
      // Each child owns a slot as wide as its whole subtree, so sibling
      // subtrees never overlap; the child node is centred in its slot.
      const slotWidths = children.map(getSubtreeWidth);
      const totalW = slotWidths.reduce((a, b) => a + b, 0) + (children.length - 1) * hGap;
      let slotX = x + size.w / 2 - totalW / 2;
      const childY = y + size.h + vGap * 2;
      for (let i = 0; i < children.length; i++) {
        const childW = sizeOf(children[i]).w;
        layoutTree(children[i], slotX + slotWidths[i] / 2 - childW / 2, childY, direction);
        slotX += slotWidths[i] + hGap;
      }
    } else {
      const subtreeHeight = getSubtreeHeight(node);
      let startY = y + size.h / 2 - subtreeHeight / 2;
      for (const child of children) {
        const ch = getSubtreeHeight(child);
        const { w: childW, h: childH } = sizeOf(child);
        const childY = startY + ch / 2 - childH / 2;
        const childX = direction === 'right'
          ? x + size.w + hGap
          : x - childW - hGap;
        layoutTree(child, childX, childY, direction);
        startY += ch + vGap;
      }
    }
  };

  /** Stacks root branches on one side of the root, centred on it vertically. */
  const layoutSide = (branches: MindmapNode[], rootSize: { w: number; h: number }, side: 'right' | 'left') => {
    let total = 0;
    for (const child of branches) total += getSubtreeHeight(child);
    total += Math.max(0, branches.length - 1) * vGap;
    let cy = el.y + rootSize.h / 2 - total / 2;
    for (const child of branches) {
      const ch = getSubtreeHeight(child);
      const { w: childW, h: childH } = sizeOf(child);
      const childX = side === 'right' ? el.x + rootSize.w + hGap : el.x - childW - hGap;
      layoutTree(child, childX, cy + ch / 2 - childH / 2, side);
      cy += ch + vGap;
    }
  };

  const elLayout = el.layout || 'mindmap_right';
  if (elLayout === 'tree_down') {
    layoutTree(root, el.x, el.y, 'down');
  } else if (elLayout === 'mindmap_left') {
    layoutTree(root, el.x, el.y, 'left');
  } else if (elLayout === 'mindmap_lr') {
    const size = sizeOf(root);
    layout.set(root.id, { x: el.x, y: el.y, w: size.w, h: size.h });
    if (!root.collapsed) {
      const { right, left } = getMindmapSides(root);
      layoutSide(right, size, 'right');
      layoutSide(left, size, 'left');
    }
  } else {
    layoutTree(root, el.x, el.y, 'right');
  }

  return layout;
}
