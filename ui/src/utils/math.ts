export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

export function pointInRect(
  px: number, py: number,
  x: number, y: number, w: number, h: number,
): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

export function pointInEllipse(
  px: number, py: number,
  cx: number, cy: number, rx: number, ry: number,
): boolean {
  if (rx <= 0 || ry <= 0) return false;
  const dx = px - cx;
  const dy = py - cy;
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
}

export function pointInDiamond(
  px: number, py: number,
  x: number, y: number, w: number, h: number,
): boolean {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hw = w / 2;
  const hh = h / 2;
  if (hw <= 0 || hh <= 0) return false;
  return Math.abs(px - cx) / hw + Math.abs(py - cy) / hh <= 1;
}

export function rectIntersects(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export interface SnapGuide {
  type: 'vertical' | 'horizontal';
  position: number;
  targetElementId?: string;
  targetEdge?: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

const SNAP_THRESHOLD = 8;

export function snapToElements(
  dragX: number, dragY: number,
  dragW: number, dragH: number,
  elements: Array<{ x: number; y: number; width: number; height: number; id: string }>,
  excludeIds: ReadonlySet<string>,
): SnapResult {
  let snappedX = dragX;
  let snappedY = dragY;
  const guides: SnapGuide[] = [];

  // Edges and centers of the dragged element
  const dragCx = dragX + dragW / 2;
  const dragCy = dragY + dragH / 2;
  const dragRight = dragX + dragW;
  const dragBottom = dragY + dragH;

  let bestDx = SNAP_THRESHOLD;
  let bestDy = SNAP_THRESHOLD;

  for (const el of elements) {
    if (excludeIds.has(el.id)) continue;

    const elCx = el.x + el.width / 2;
    const elCy = el.y + el.height / 2;
    const elRight = el.x + el.width;
    const elBottom = el.y + el.height;

    // Vertical snaps (x-axis alignment)
    const xSnaps = [
      { from: dragX, to: el.x, edge: 'left' as const },
      { from: dragX, to: elRight, edge: 'right' as const },
      { from: dragRight, to: el.x, edge: 'left' as const },
      { from: dragRight, to: elRight, edge: 'right' as const },
      { from: dragCx, to: elCx, edge: 'centerX' as const },
    ];

    for (const snap of xSnaps) {
      const diff = Math.abs(snap.from - snap.to);
      if (diff < bestDx) {
        bestDx = diff;
        snappedX = dragX + (snap.to - snap.from);
        guides.length = 0; // Clear old guides for this axis
        guides.push({ type: 'vertical', position: snap.to, targetElementId: el.id, targetEdge: snap.edge });
      } else if (diff === bestDx && diff < SNAP_THRESHOLD) {
        guides.push({ type: 'vertical', position: snap.to, targetElementId: el.id, targetEdge: snap.edge });
      }
    }

    // Horizontal snaps (y-axis alignment)
    const ySnaps = [
      { from: dragY, to: el.y, edge: 'top' as const },
      { from: dragY, to: elBottom, edge: 'bottom' as const },
      { from: dragBottom, to: el.y, edge: 'top' as const },
      { from: dragBottom, to: elBottom, edge: 'bottom' as const },
      { from: dragCy, to: elCy, edge: 'centerY' as const },
    ];

    for (const snap of ySnaps) {
      const diff = Math.abs(snap.from - snap.to);
      if (diff < bestDy) {
        bestDy = diff;
        snappedY = dragY + (snap.to - snap.from);
        // Keep existing vertical guides, just filter horizontal
        const vertGuides = guides.filter(g => g.type === 'vertical');
        guides.length = 0;
        guides.push(...vertGuides);
        guides.push({ type: 'horizontal', position: snap.to, targetElementId: el.id, targetEdge: snap.edge });
      } else if (diff === bestDy && diff < SNAP_THRESHOLD) {
        guides.push({ type: 'horizontal', position: snap.to, targetElementId: el.id, targetEdge: snap.edge });
      }
    }
  }

  return { x: snappedX, y: snappedY, guides };
}
