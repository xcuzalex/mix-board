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
import { canvasTheme } from '../canvas-theme';

export function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
  color: string, lineWidth: number,
  arrowType: ArrowType = 'arrow',
) {
  const headLen = arrowHeadLength(lineWidth);
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const halfAngle = Math.PI / 7;

  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (arrowType) {
    case 'arrow': // Filled triangle
    case 'triangle': {
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLen * Math.cos(angle - halfAngle), toY - headLen * Math.sin(angle - halfAngle));
      ctx.lineTo(toX - headLen * Math.cos(angle + halfAngle), toY - headLen * Math.sin(angle + halfAngle));
      ctx.closePath();
      ctx.fill();
      // A thin round-joined outline softens the tip and barbs.
      ctx.lineWidth = Math.min(lineWidth, 2);
      ctx.stroke();
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
      ctx.fillStyle = canvasTheme.background;
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
        ctx.fillStyle = canvasTheme.background;
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
        ctx.fillStyle = canvasTheme.background;
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

type Pt = [number, number];

const MIN_HANDLE = 18;
const ELBOW_STUB = 24;
const CORNER_RADIUS = 12;
/** Arrowhead types whose shaft should stop short so it doesn't poke through the tip. */
const TRIMMED_HEADS = new Set<ArrowType>(['arrow', 'triangle', 'hollow_arrow', 'hollow_triangle']);

function arrowHeadLength(lineWidth: number) {
  return Math.max(10, lineWidth * 4);
}

/**
 * Handle length along an anchor's normal (React Flow style): half the forward
 * distance, and a small loop when the other end is behind the anchor.
 */
function controlOffset(forward: number) {
  return forward >= 0 ? 0.5 * forward : 6 * Math.sqrt(-forward);
}

/** For a free endpoint, leave along the dominant axis toward the other end. */
function axisNormal(from: Pt, to: Pt): Pt {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
}

function endpointNormals(sceneIndex: SceneIndex, linear: LinearElement, start: Pt, end: Pt): [Pt, Pt] {
  const startNormal = linear.startBinding
    ? getConnectionAnchorFromBinding(sceneIndex, linear.startBinding)?.normal ?? getAnchorNormalFromFocus(linear.startBinding.focus)
    : null;
  const endNormal = linear.endBinding
    ? getConnectionAnchorFromBinding(sceneIndex, linear.endBinding)?.normal ?? getAnchorNormalFromFocus(linear.endBinding.focus)
    : null;
  return [startNormal ?? axisNormal(start, end), endNormal ?? axisNormal(end, start)];
}

function curveControlPoints(sceneIndex: SceneIndex, linear: LinearElement, start: Pt, end: Pt): [Pt, Pt] {
  const [startNormal, endNormal] = endpointNormals(sceneIndex, linear, start, end);
  const handle = (point: Pt, normal: Pt, other: Pt): Pt => {
    const forward = (other[0] - point[0]) * normal[0] + (other[1] - point[1]) * normal[1];
    const length = Math.max(controlOffset(forward), MIN_HANDLE);
    return [point[0] + normal[0] * length, point[1] + normal[1] * length];
  };
  return [handle(start, startNormal, end), handle(end, endNormal, start)];
}

/** Orthogonal route between two anchors: leave and arrive along each normal. */
function elbowRoute(sceneIndex: SceneIndex, linear: LinearElement, start: Pt, end: Pt): Pt[] {
  const [sn, en] = endpointNormals(sceneIndex, linear, start, end);
  const startHorizontal = sn[0] !== 0;
  const endHorizontal = en[0] !== 0;
  const s1: Pt = [start[0] + sn[0] * ELBOW_STUB, start[1] + sn[1] * ELBOW_STUB];
  const e1: Pt = [end[0] + en[0] * ELBOW_STUB, end[1] + en[1] * ELBOW_STUB];

  let middle: Pt[];
  if (startHorizontal && endHorizontal) {
    // Opposite-facing anchors meet halfway; same-facing ones wrap around the outside.
    const midX = sn[0] === en[0]
      ? (sn[0] > 0 ? Math.max(s1[0], e1[0]) : Math.min(s1[0], e1[0]))
      : (start[0] + end[0]) / 2;
    middle = [[midX, start[1]], [midX, end[1]]];
  } else if (!startHorizontal && !endHorizontal) {
    const midY = sn[1] === en[1]
      ? (sn[1] > 0 ? Math.max(s1[1], e1[1]) : Math.min(s1[1], e1[1]))
      : (start[1] + end[1]) / 2;
    middle = [[start[0], midY], [end[0], midY]];
  } else if (startHorizontal) {
    middle = [[end[0], start[1]]];
  } else {
    middle = [[start[0], end[1]]];
  }
  return dedupe([start, ...middle, end]);
}

function dedupe(points: Pt[]): Pt[] {
  return points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.5);
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

/** de Casteljau: the part of a cubic between t0 and t1. */
function cubicSegment(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t0: number, t1: number): [Pt, Pt, Pt, Pt] {
  // Keep [0, t1] ...
  let a = lerp(p0, p1, t1), b = lerp(p1, p2, t1), c = lerp(p2, p3, t1);
  let ab = lerp(a, b, t1), bc = lerp(b, c, t1);
  const q = [p0, a, ab, lerp(ab, bc, t1)] as [Pt, Pt, Pt, Pt];
  if (t0 <= 0) return q;
  // ... then keep [t0 / t1, 1] of that.
  const u = t0 / t1;
  a = lerp(q[0], q[1], u); b = lerp(q[1], q[2], u); c = lerp(q[2], q[3], u);
  ab = lerp(a, b, u); bc = lerp(b, c, u);
  return [lerp(ab, bc, u), bc, c, q[3]];
}

/** Parameter where the curve is `distance` away from its end (or start). */
function cubicTrimT(p0: Pt, p1: Pt, p2: Pt, p3: Pt, distance: number, fromEnd: boolean) {
  const anchor = fromEnd ? p3 : p0;
  let lo = fromEnd ? 0.5 : 0;
  let hi = fromEnd ? 1 : 0.5;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const pt = cubicAt(p0, p1, p2, p3, mid);
    const d = Math.hypot(pt[0] - anchor[0], pt[1] - anchor[1]);
    if (fromEnd ? d > distance : d < distance) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Shorten a polyline at either end by moving the end points along their segments. */
function trimPolyline(points: Pt[], startTrim: number, endTrim: number): Pt[] {
  const out = points.map((p) => [...p] as Pt);
  const pull = (tip: Pt, from: Pt, amount: number): Pt => {
    const len = Math.hypot(tip[0] - from[0], tip[1] - from[1]);
    if (len < 1e-6 || amount <= 0) return tip;
    return lerp(tip, from, Math.min(amount, len * 0.9) / len);
  };
  if (out.length >= 2) {
    out[out.length - 1] = pull(out[out.length - 1], out[out.length - 2], endTrim);
    out[0] = pull(out[0], out[1], startTrim);
  }
  return out;
}

/** Polyline with corners rounded by up to `radius`, never past half a segment. */
function strokeRoundedPolyline(ctx: CanvasRenderingContext2D, points: Pt[], radius: number) {
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], curr = points[i], next = points[i + 1];
    const r = Math.min(
      radius,
      Math.hypot(curr[0] - prev[0], curr[1] - prev[1]) / 2,
      Math.hypot(next[0] - curr[0], next[1] - curr[1]) / 2,
    );
    ctx.arcTo(curr[0], curr[1], next[0], next[1], r);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last[0], last[1]);
}

/**
 * The connector's drawn path flattened to a polyline (curves sampled), so hit
 * testing follows what the user actually sees rather than the straight chord.
 */
export function getLinearPathPoints(el: LinearElement, sceneIndex: SceneIndex): Pt[] {
  const pts = getLinearAbsolutePoints(el, sceneIndex) as Pt[];
  if (pts.length < 2) return pts;
  const shape = el.connectorShape || 'straight';
  if (shape === 'curve' && pts.length === 2) {
    const [start, end] = pts;
    const [c1, c2] = curveControlPoints(sceneIndex, el, start, end);
    const samples = 24;
    return Array.from({ length: samples + 1 }, (_, i) => cubicAt(start, c1, c2, end, i / samples));
  }
  if (shape === 'curve') {
    const out: Pt[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
      const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      for (let k = 1; k <= 12; k++) out.push(cubicAt(p1, c1, c2, p2, k / 12));
    }
    return out;
  }
  if (shape === 'right_angled_polyline') {
    return pts.length === 2 ? elbowRoute(sceneIndex, el, pts[0], pts[1]) : multiElbow(pts);
  }
  return pts;
}

function multiElbow(pts: Pt[]): Pt[] {
  return dedupe(pts.flatMap((p, i) => {
    if (i === 0) return [p];
    const midX = (pts[i - 1][0] + p[0]) / 2;
    return [[midX, pts[i - 1][1]] as Pt, [midX, p[1]] as Pt, p];
  }));
}

export function drawLinear(ctx: CanvasRenderingContext2D, el: Element, sceneIndex: SceneIndex) {
  if (el.type !== 'line' && el.type !== 'arrow') return;
  const linear = el as LinearElement;
  const pts = getLinearAbsolutePoints(linear, sceneIndex) as Pt[];
  if (pts.length < 2) return;

  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  applyStrokeStyle(ctx, el.strokeStyle);

  const shape = linear.connectorShape || 'straight';
  const startType = linear.startArrowType || 'none';
  const endType = linear.endArrowType || 'none';
  const headLen = arrowHeadLength(el.strokeWidth);
  const startTrim = TRIMMED_HEADS.has(startType) ? headLen * 0.6 : 0;
  const endTrim = TRIMMED_HEADS.has(endType) ? headLen * 0.6 : 0;

  // Direction each arrowhead points along: the path's tangent at that end.
  let startFrom: Pt = pts[1];
  let endFrom: Pt = pts[pts.length - 2];

  ctx.beginPath();

  if (shape === 'curve' && pts.length === 2) {
    const [start, end] = pts;
    const [c1, c2] = curveControlPoints(sceneIndex, linear, start, end);
    startFrom = Math.hypot(c1[0] - start[0], c1[1] - start[1]) > 1 ? c1 : c2;
    endFrom = Math.hypot(c2[0] - end[0], c2[1] - end[1]) > 1 ? c2 : c1;
    const t0 = startTrim > 0 ? cubicTrimT(start, c1, c2, end, startTrim, false) : 0;
    const t1 = endTrim > 0 ? cubicTrimT(start, c1, c2, end, endTrim, true) : 1;
    const [q0, q1, q2, q3] = cubicSegment(start, c1, c2, end, t0, t1);
    ctx.moveTo(q0[0], q0[1]);
    ctx.bezierCurveTo(q1[0], q1[1], q2[0], q2[1], q3[0], q3[1]);
  } else if (shape === 'curve') {
    // Waypoints: Catmull-Rom through every point.
    const path = trimPolyline(pts, startTrim, endTrim);
    ctx.moveTo(path[0][0], path[0][1]);
    for (let i = 0; i < path.length - 1; i++) {
      const p0 = path[Math.max(i - 1, 0)];
      const p1 = path[i];
      const p2 = path[i + 1];
      const p3 = path[Math.min(i + 2, path.length - 1)];
      ctx.bezierCurveTo(
        p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
        p2[0], p2[1],
      );
    }
  } else if (shape === 'right_angled_polyline') {
    const path = pts.length === 2 ? elbowRoute(sceneIndex, linear, pts[0], pts[1]) : multiElbow(pts);
    startFrom = path[1] ?? startFrom;
    endFrom = path[path.length - 2] ?? endFrom;
    strokeRoundedPolyline(ctx, trimPolyline(path, startTrim, endTrim), CORNER_RADIUS);
  } else {
    strokeRoundedPolyline(ctx, trimPolyline(pts, startTrim, endTrim), pts.length > 2 ? CORNER_RADIUS : 0);
  }
  ctx.stroke();

  const last = pts[pts.length - 1];
  if (endType !== 'none') {
    drawArrowHead(ctx, endFrom[0], endFrom[1], last[0], last[1], el.strokeColor, el.strokeWidth, endType);
  }
  if (startType !== 'none') {
    drawArrowHead(ctx, startFrom[0], startFrom[1], pts[0][0], pts[0][1], el.strokeColor, el.strokeWidth, startType);
  }
}
