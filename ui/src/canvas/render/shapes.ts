/**
 * Basic shape element renderers (rectangle / ellipse / diamond / triangle /
 * variant shapes) and their inline text. Extracted from renderer.ts (P0.B).
 *
 * The four basic shapes render with a hand-drawn (rough.js) look (画风增量2);
 * each element uses a stable seed derived from its id so the sketch doesn't
 * jitter between frames. Variant (flowchart/UML) shapes keep crisp Path2D
 * rendering. Inline text is always crisp.
 */
import type { Element } from '../../types/element';
import type { RoughCanvas } from 'roughjs/bin/canvas';
import type { Options } from 'roughjs/bin/core';
import { getElementShapeVariant, renderShapeDecoration } from '../shape-utils';
import { applyStrokeStyle } from './stroke';

/** Cache-backed Path2D builder owned by the Renderer instance. */
export type GetShapePath = (variant: string, width: number, height: number, roundness: number) => Path2D;

/** Stable integer seed from an element id so rough.js output is deterministic per element. */
export function seedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 2147483646) + 1;
}

function roughOptions(el: Element, seed: number): Options {
  const opts: Options = {
    seed,
    roughness: 1.1,
    bowing: 1,
    preserveVertices: true,
  };
  if (el.strokeWidth > 0) {
    opts.stroke = el.strokeColor;
    opts.strokeWidth = el.strokeWidth;
    if (el.strokeStyle === 'dashed') opts.strokeLineDash = [8, 8];
    else if (el.strokeStyle === 'dotted') opts.strokeLineDash = [2, 6];
  } else {
    opts.stroke = 'none';
  }
  if (el.backgroundColor && el.backgroundColor !== 'transparent') {
    opts.fill = el.backgroundColor;
    opts.fillStyle = 'solid';
  }
  return opts;
}

export function drawShapeText(ctx: CanvasRenderingContext2D, el: Element, editingElementId: string | null) {
  if (!el.text || editingElementId === el.id) return;
  const fontSize = el.fontSize ?? 16;
  const fontFamily = el.fontFamily ?? "'Kalam', 'Inter', system-ui, sans-serif";
  const textAlign = el.textAlign ?? 'center';
  ctx.save();
  ctx.fillStyle = el.strokeColor || '#1B1B1F';
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textAlign = textAlign;
  ctx.textBaseline = 'middle';
  const lines = el.text.split('\n');
  const lineHeight = fontSize * 1.3;
  const totalH = lines.length * lineHeight;
  const startY = el.y + el.height / 2 - totalH / 2 + lineHeight / 2;
  let textX = el.x + el.width / 2;
  if (textAlign === 'left') textX = el.x + 8;
  else if (textAlign === 'right') textX = el.x + el.width - 8;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], textX, startY + i * lineHeight, el.width - 16);
  }
  ctx.restore();
}

export function drawVariantShape(
  ctx: CanvasRenderingContext2D,
  el: Element & { roundness?: number },
  editingElementId: string | null,
  getShapePath: GetShapePath,
) {
  const variant = getElementShapeVariant(el);
  const path = getShapePath(variant, el.width, el.height, el.roundness ?? 8);

  ctx.save();
  ctx.translate(el.x, el.y);

  if (el.backgroundColor && el.backgroundColor !== 'transparent') {
    ctx.fillStyle = el.backgroundColor;
    ctx.fill(path);
  }

  if (el.strokeWidth > 0) {
    ctx.strokeStyle = el.strokeColor;
    ctx.lineWidth = el.strokeWidth;
    applyStrokeStyle(ctx, el.strokeStyle);
    ctx.stroke(path);
    renderShapeDecoration(ctx, variant, 0, 0, el.width, el.height);
  }

  ctx.restore();

  drawShapeText(ctx, el, editingElementId);
}

export function drawRectangle(
  ctx: CanvasRenderingContext2D,
  el: Element & { roundness?: number },
  editingElementId: string | null,
  getShapePath: GetShapePath,
  rc: RoughCanvas,
) {
  const variant = getElementShapeVariant(el);
  if (variant !== 'rectangle' && variant !== 'round_rectangle' && variant !== 'pill') {
    drawVariantShape(ctx, el, editingElementId, getShapePath);
    return;
  }
  rc.rectangle(el.x, el.y, el.width, el.height, roughOptions(el, seedFromId(el.id)));
  drawShapeText(ctx, el, editingElementId);
}

export function drawEllipse(
  ctx: CanvasRenderingContext2D,
  el: Element,
  editingElementId: string | null,
  getShapePath: GetShapePath,
  rc: RoughCanvas,
) {
  const variant = getElementShapeVariant(el);
  if (variant !== 'ellipse') {
    drawVariantShape(ctx, el, editingElementId, getShapePath);
    return;
  }
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  rc.ellipse(cx, cy, Math.abs(el.width), Math.abs(el.height), roughOptions(el, seedFromId(el.id)));
  drawShapeText(ctx, el, editingElementId);
}

export function drawDiamond(
  ctx: CanvasRenderingContext2D,
  el: Element,
  editingElementId: string | null,
  getShapePath: GetShapePath,
  rc: RoughCanvas,
) {
  const variant = getElementShapeVariant(el);
  if (variant !== 'diamond') {
    drawVariantShape(ctx, el, editingElementId, getShapePath);
    return;
  }
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  rc.polygon(
    [
      [cx, el.y],
      [el.x + el.width, cy],
      [cx, el.y + el.height],
      [el.x, cy],
    ],
    roughOptions(el, seedFromId(el.id)),
  );
  drawShapeText(ctx, el, editingElementId);
}

export function drawTriangle(
  ctx: CanvasRenderingContext2D,
  el: Element,
  editingElementId: string | null,
  getShapePath: GetShapePath,
  rc: RoughCanvas,
) {
  const variant = getElementShapeVariant(el);
  if (variant !== 'triangle') {
    drawVariantShape(ctx, el, editingElementId, getShapePath);
    return;
  }
  rc.polygon(
    [
      [el.x + el.width / 2, el.y],
      [el.x + el.width, el.y + el.height],
      [el.x, el.y + el.height],
    ],
    roughOptions(el, seedFromId(el.id)),
  );
  drawShapeText(ctx, el, editingElementId);
}
