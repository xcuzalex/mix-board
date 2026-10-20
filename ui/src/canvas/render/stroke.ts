/**
 * Shared, stateless stroke-style helper used across element renderers.
 * Extracted from renderer.ts (P0.B).
 */
export function applyStrokeStyle(ctx: CanvasRenderingContext2D, style: string) {
  switch (style) {
    case 'dashed':
      ctx.setLineDash([8, 4]);
      break;
    case 'dotted':
      ctx.setLineDash([2, 4]);
      break;
    default:
      ctx.setLineDash([]);
  }
}
