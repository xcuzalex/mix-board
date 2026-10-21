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
import type { Drawable, Options } from 'roughjs/bin/core';
import type { RoughGenerator } from 'roughjs/bin/generator';
import { getElementShapeVariant, getShapePathData, renderShapeDecoration } from '../shape-utils';
import { applyStrokeStyle } from './stroke';

// --- rough.js drawable cache -------------------------------------------------
// Generating a sketch (rough's generator) is the expensive part; drawing a
// Drawable is cheap. Drawables are built at the origin and drawn translated, so
// moving an element reuses its sketch and only size / style changes regenerate.
const MAX_DRAWABLES = 1000;
const drawableCache = new Map<string, Drawable>();

function getCachedDrawable(key: string, build: () => Drawable): Drawable {
  const hit = drawableCache.get(key);
  if (hit) {
    // LRU: re-insert so the entry becomes the most recently used.
    drawableCache.delete(key);
    drawableCache.set(key, hit);
    return hit;
  }
  const drawable = build();
  drawableCache.set(key, drawable);
  if (drawableCache.size > MAX_DRAWABLES) {
    const oldest = drawableCache.keys().next().value;
    if (oldest !== undefined) drawableCache.delete(oldest);
  }
  return drawable;
}

type RoughShapeKind = 'rectangle' | 'round_rectangle' | 'pill' | 'ellipse' | 'diamond' | 'triangle';

function buildRoughShape(
  gen: RoughGenerator,
  kind: RoughShapeKind,
  w: number,
  h: number,
  roundness: number,
  opts: Options,
): Drawable {
  switch (kind) {
    case 'rectangle':
      return gen.rectangle(0, 0, w, h, opts);
    case 'round_rectangle':
    case 'pill':
      // Rough path over the same rounded-rect outline the crisp renderer uses,
      // so `roundness` (and the pill's full radius) shows in the sketch.
      return gen.path(getShapePathData(kind, 0, 0, w, h, roundness), opts);
    case 'ellipse':
      return gen.ellipse(w / 2, h / 2, Math.abs(w), Math.abs(h), opts);
    case 'diamond':
      return gen.polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], opts);
    case 'triangle':
      return gen.polygon([[w / 2, 0], [w, h], [0, h]], opts);
  }
}

/** Draws a basic shape as a cached rough.js sketch, translated to the element. */
function drawRoughShape(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  el: Element & { roundness?: number },
  kind: RoughShapeKind,
) {
  const seed = seedFromId(el.id);
  const roundness = el.roundness ?? 8;
  const key = [
    el.id, kind, el.width, el.height, roundness,
    el.strokeColor, el.strokeWidth, el.strokeStyle, el.backgroundColor, seed,
  ].join('|');
  const drawable = getCachedDrawable(
    key,
    () => buildRoughShape(rc.generator, kind, el.width, el.height, roundness, roughOptions(el, seed)),
  );
  ctx.save();
  ctx.translate(el.x, el.y);
  rc.draw(drawable);
  ctx.restore();
}

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
  drawRoughShape(ctx, rc, el, variant);
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
  drawRoughShape(ctx, rc, el, 'ellipse');
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
  drawRoughShape(ctx, rc, el, 'diamond');
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
  drawRoughShape(ctx, rc, el, 'triangle');
  drawShapeText(ctx, el, editingElementId);
}
