/**
 * Connector (line / arrow) rendering: the stroke path for all connector shapes,
 * bound-curve control points, and arrowheads. Extracted from renderer.ts (P0.B).
 *
 * Pure drawing functions — the only state they need is the SceneIndex (to resolve
 * bound endpoints), which is threaded in. Geometry/binding math still lives in
 * ../linear; this module is purely the 2D-canvas drawing of it.
 */
import type { Element, LinearElement, ArrowType } from '../../types/element';
import {
  getAnchorNormalFromFocus,
  getConnectionAnchorFromBinding,
  getLinearAbsolutePoints,
  type SceneIndex,
} from '../linear';
import { applyStrokeStyle } from './stroke';

export function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
  color: string, lineWidth: number,
  arrowType: ArrowType = 'arrow',
) {
  const headLen = Math.max(10, lineWidth * 4);
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const halfAngle = Math.PI / 6;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;

  switch (arrowType) {
    case 'arrow': // Filled triangle
    case 'triangle': {
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLen * Math.cos(angle - halfAngle), toY - headLen * Math.sin(angle - halfAngle));
      ctx.lineTo(toX - headLen * Math.cos(angle + halfAngle), toY - headLen * Math.sin(angle + halfAngle));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'open_arrow': { // V shape (no fill)
      ctx.beginPath();
      ctx.moveTo(toX - headLen * Math.cos(angle - halfAngle), toY - headLen * Math.sin(angle - halfAngle));
      ctx.lineTo(toX, toY);
      ctx.lineTo(toX - headLen * Math.cos(angle + halfAngle), toY - headLen * Math.sin(angle + halfAngle));
      ctx.stroke();
      break;
    }
    case 'hollow_arrow':
    case 'hollow_triangle': { // Hollow triangle
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLen * Math.cos(angle - halfAngle), toY - headLen * Math.sin(angle - halfAngle));
      ctx.lineTo(toX - headLen * Math.cos(angle + halfAngle), toY - headLen * Math.sin(angle + halfAngle));
      ctx.closePath();
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'diamond':
    case 'hollow_diamond': {
      const r = headLen * 0.6;
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - r * Math.cos(angle) + r * 0.5 * Math.sin(angle), toY - r * Math.sin(angle) - r * 0.5 * Math.cos(angle));
      ctx.lineTo(toX - 2 * r * Math.cos(angle), toY - 2 * r * Math.sin(angle));
      ctx.lineTo(toX - r * Math.cos(angle) - r * 0.5 * Math.sin(angle), toY - r * Math.sin(angle) + r * 0.5 * Math.cos(angle));
      ctx.closePath();
      if (arrowType === 'hollow_diamond') {
        ctx.fillStyle = '#FFFFFF';
      }
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'circle':
    case 'hollow_circle': {
      const r = headLen * 0.35;
      const cx = toX - r * Math.cos(angle);
      const cy = toY - r * Math.sin(angle);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (arrowType === 'hollow_circle') {
        ctx.fillStyle = '#FFFFFF';
      }
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'bar': {
      const barLen = headLen * 0.6;
      ctx.beginPath();
      ctx.moveTo(toX + barLen * Math.sin(angle), toY - barLen * Math.cos(angle));
      ctx.lineTo(toX - barLen * Math.sin(angle), toY + barLen * Math.cos(angle));
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

function getStableBoundCurveControlPoints(
  sceneIndex: SceneIndex,
  linear: LinearElement,
  points: [number, number][],
): { cp1x: number; cp1y: number; cp2x: number; cp2y: number } {
  const start = points[0];
  const end = points[1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const distance = Math.hypot(dx, dy);
  const major = Math.max(Math.abs(dx), Math.abs(dy));
  const minor = Math.min(Math.abs(dx), Math.abs(dy));
  const offset = Math.min(Math.abs(dx), Math.abs(dy)) * 0.4;

  let cp1x = start[0] + dx * 0.25 + (Math.abs(dy) > Math.abs(dx) ? offset : 0);
  let cp1y = start[1] + dy * 0.25 + (Math.abs(dx) > Math.abs(dy) ? offset : 0);
  let cp2x = end[0] - dx * 0.25 + (Math.abs(dy) > Math.abs(dx) ? offset : 0);
  let cp2y = end[1] - dy * 0.25 + (Math.abs(dx) > Math.abs(dy) ? offset : 0);

  const applyNormalHandle = (
    point: [number, number],
    normal: [number, number],
  ): [number, number] => {
    const projected = Math.abs(dx * normal[0] + dy * normal[1]);
    const handleLength = Math.min(
      Math.max(major * 0.45, minor * 0.7, projected * 0.9, 20),
      Math.max(distance * 0.7, 28),
    );
    return [point[0] + normal[0] * handleLength, point[1] + normal[1] * handleLength];
  };

  const startNormal = linear.startBinding
    ? getConnectionAnchorFromBinding(sceneIndex, linear.startBinding)?.normal ?? getAnchorNormalFromFocus(linear.startBinding.focus)
    : null;
  const endNormal = linear.endBinding
    ? getConnectionAnchorFromBinding(sceneIndex, linear.endBinding)?.normal ?? getAnchorNormalFromFocus(linear.endBinding.focus)
    : null;

  if (startNormal) {
    [cp1x, cp1y] = applyNormalHandle(start, startNormal);
  }
  if (endNormal) {
    [cp2x, cp2y] = applyNormalHandle(end, endNormal);
  }

  return { cp1x, cp1y, cp2x, cp2y };
}

export function drawLinear(ctx: CanvasRenderingContext2D, el: Element, sceneIndex: SceneIndex) {
  if (el.type !== 'line' && el.type !== 'arrow') return;
  const linear = el as LinearElement;
  const pts = getLinearAbsolutePoints(linear, sceneIndex);
  if (pts.length < 2) return;

  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  applyStrokeStyle(ctx, el.strokeStyle);

  const shape = linear.connectorShape || 'straight';
  const cornerRadius = Math.min(el.strokeWidth * 2, 12);

  ctx.beginPath();

  if (shape === 'curve' && pts.length >= 2) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 2) {
      const { cp1x, cp1y, cp2x, cp2y } = getStableBoundCurveControlPoints(sceneIndex, linear, pts as [[number, number], [number, number]]);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, pts[1][0], pts[1][1]);
    } else {
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(i - 1, 0)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(i + 2, pts.length - 1)];
        const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
        const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
        const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
        const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
      }
    }
  } else if (shape === 'right_angled_polyline' && pts.length >= 2) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const midX = (prev[0] + curr[0]) / 2;
      if (i === 1) {
        ctx.lineTo(midX, prev[1]);
      }
      ctx.arcTo(midX, curr[1], curr[0], curr[1], cornerRadius);
      if (i === pts.length - 1) {
        ctx.lineTo(curr[0], curr[1]);
      } else {
        const next = pts[i + 1];
        const nextMidX = (curr[0] + next[0]) / 2;
        ctx.lineTo(nextMidX, curr[1]);
      }
    }
  } else {
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 2 || cornerRadius === 0) {
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
    } else {
      for (let i = 1; i < pts.length - 1; i++) {
        ctx.arcTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], cornerRadius);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    }
  }
  ctx.stroke();

  if (el.type === 'arrow' || el.type === 'line') {
    const startType = linear.startArrowType || 'none';
    const endType = linear.endArrowType || 'none';

    if (endType !== 'none' && pts.length >= 2) {
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      drawArrowHead(ctx, prev[0], prev[1], last[0], last[1], el.strokeColor, el.strokeWidth, endType);
    }
    if (startType !== 'none' && pts.length >= 2) {
      drawArrowHead(ctx, pts[1][0], pts[1][1], pts[0][0], pts[0][1], el.strokeColor, el.strokeWidth, startType);
    }
  }
}
