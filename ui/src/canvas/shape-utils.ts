import type { Element, ShapeVariant } from '../types/element';

type ShapeTool = 'rectangle' | 'ellipse' | 'diamond' | 'triangle';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function polygonPath(points: Array<[number, number]>) {
  return `${points.map(([px, py], index) => `${index === 0 ? 'M' : 'L'} ${px} ${py}`).join(' ')} Z`;
}

function roundedRectPath(x: number, y: number, width: number, height: number, radius: number) {
  const r = clamp(radius, 0, Math.min(width, height) / 2);
  if (r === 0) return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`;
  return [
    `M ${x + r} ${y}`,
    `H ${x + width - r}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `V ${y + height - r}`,
    `Q ${x + width} ${y + height} ${x + width - r} ${y + height}`,
    `H ${x + r}`,
    `Q ${x} ${y + height} ${x} ${y + height - r}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    'Z',
  ].join(' ');
}

function ellipsePath(x: number, y: number, width: number, height: number) {
  const rx = width / 2;
  const ry = height / 2;
  const cx = x + rx;
  return [
    `M ${cx} ${y}`,
    `A ${rx} ${ry} 0 1 1 ${cx} ${y + height}`,
    `A ${rx} ${ry} 0 1 1 ${cx} ${y}`,
    'Z',
  ].join(' ');
}

export function isShapeTool(tool: string): tool is ShapeTool {
  return ['rectangle', 'ellipse', 'diamond', 'triangle'].includes(tool);
}

export function getDefaultShapeVariant(tool: ShapeTool): ShapeVariant {
  switch (tool) {
    case 'ellipse':
      return 'ellipse';
    case 'diamond':
      return 'diamond';
    case 'triangle':
      return 'triangle';
    default:
      return 'round_rectangle';
  }
}

export function getElementShapeVariant(el: Pick<Element, 'type' | 'shapeVariant'>): ShapeVariant {
  if (el.shapeVariant) return el.shapeVariant;
  if (el.type === 'ellipse') return 'ellipse';
  if (el.type === 'diamond') return 'diamond';
  if (el.type === 'triangle') return 'triangle';
  return 'rectangle';
}

export function getShapePathData(
  variant: ShapeVariant,
  x: number,
  y: number,
  width: number,
  height: number,
  roundness = 8,
) {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const cx = x + w / 2;
  const cy = y + h / 2;

  switch (variant) {
    case 'rectangle':
      return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
    case 'round_rectangle':
      return roundedRectPath(x, y, w, h, Math.max(12, roundness));
    case 'pill':
      return roundedRectPath(x, y, w, h, Math.min(w, h) / 2);
    case 'ellipse':
      return ellipsePath(x, y, w, h);
    case 'diamond':
      return polygonPath([
        [cx, y],
        [x + w, cy],
        [cx, y + h],
        [x, cy],
      ]);
    case 'triangle':
      return polygonPath([
        [cx, y],
        [x + w, y + h],
        [x, y + h],
      ]);
    case 'hexagon':
      return polygonPath([
        [x + w * 0.24, y],
        [x + w * 0.76, y],
        [x + w, y + h * 0.5],
        [x + w * 0.76, y + h],
        [x + w * 0.24, y + h],
        [x, y + h * 0.5],
      ]);
    case 'octagon':
      return polygonPath([
        [x + w * 0.28, y],
        [x + w * 0.72, y],
        [x + w, y + h * 0.28],
        [x + w, y + h * 0.72],
        [x + w * 0.72, y + h],
        [x + w * 0.28, y + h],
        [x, y + h * 0.72],
        [x, y + h * 0.28],
      ]);
    case 'parallelogram':
      return polygonPath([
        [x + w * 0.18, y],
        [x + w, y],
        [x + w * 0.82, y + h],
        [x, y + h],
      ]);
    case 'trapezoid':
      return polygonPath([
        [x + w * 0.2, y],
        [x + w * 0.8, y],
        [x + w, y + h],
        [x, y + h],
      ]);
    case 'star': {
      const points: Array<[number, number]> = [];
      const outer = Math.min(w, h) * 0.5;
      const inner = outer * 0.45;
      for (let index = 0; index < 10; index += 1) {
        const radius = index % 2 === 0 ? outer : inner;
        const angle = -Math.PI / 2 + (Math.PI / 5) * index;
        points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
      }
      return polygonPath(points);
    }
    case 'speech_bubble': {
      const r = Math.min(w, h) * 0.14;
      const tailX = x + w * 0.34;
      const tailTipX = x + w * 0.22;
      const tailTipY = y + h + h * 0.14;
      return [
        `M ${x + r} ${y}`,
        `H ${x + w - r}`,
        `Q ${x + w} ${y} ${x + w} ${y + r}`,
        `V ${y + h - r}`,
        `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
        `H ${tailX + w * 0.14}`,
        `L ${tailTipX} ${tailTipY}`,
        `L ${tailX} ${y + h}`,
        `H ${x + r}`,
        `Q ${x} ${y + h} ${x} ${y + h - r}`,
        `V ${y + r}`,
        `Q ${x} ${y} ${x + r} ${y}`,
        'Z',
      ].join(' ');
    }
    case 'cloud':
      return [
        `M ${x + w * 0.24} ${y + h * 0.82}`,
        `C ${x + w * 0.1} ${y + h * 0.82} ${x + w * 0.02} ${y + h * 0.66} ${x + w * 0.08} ${y + h * 0.52}`,
        `C ${x + w * 0.02} ${y + h * 0.26} ${x + w * 0.24} ${y + h * 0.08} ${x + w * 0.44} ${y + h * 0.18}`,
        `C ${x + w * 0.52} ${y + h * 0.02} ${x + w * 0.8} ${y + h * 0.06} ${x + w * 0.84} ${y + h * 0.28}`,
        `C ${x + w * 0.98} ${y + h * 0.3} ${x + w} ${y + h * 0.5} ${x + w * 0.88} ${y + h * 0.62}`,
        `C ${x + w * 0.9} ${y + h * 0.8} ${x + w * 0.68} ${y + h * 0.94} ${x + w * 0.5} ${y + h * 0.84}`,
        `C ${x + w * 0.4} ${y + h * 0.96} ${x + w * 0.28} ${y + h * 0.92} ${x + w * 0.24} ${y + h * 0.82}`,
        'Z',
      ].join(' ');
    case 'cylinder': {
      const ry = Math.min(h * 0.18, 18);
      return [
        `M ${x} ${y + ry}`,
        `C ${x} ${y + ry * 0.4} ${x + w} ${y + ry * 0.4} ${x + w} ${y + ry}`,
        `V ${y + h - ry}`,
        `C ${x + w} ${y + h - ry * 0.4} ${x} ${y + h - ry * 0.4} ${x} ${y + h - ry}`,
        'Z',
      ].join(' ');
    }
    case 'document':
      return polygonPath([
        [x, y],
        [x + w * 0.76, y],
        [x + w, y + h * 0.24],
        [x + w, y + h],
        [x, y + h],
      ]);
    case 'multi_document':
      return polygonPath([
        [x, y + h * 0.04],
        [x + w * 0.76, y + h * 0.04],
        [x + w, y + h * 0.26],
        [x + w, y + h],
        [x, y + h],
      ]);
    case 'predefined_process':
      return roundedRectPath(x, y, w, h, Math.max(8, roundness));
    case 'manual_input':
      return polygonPath([
        [x + w * 0.14, y],
        [x + w, y],
        [x + w * 0.86, y + h],
        [x, y + h],
      ]);
    case 'display':
      return [
        `M ${x + w * 0.12} ${y}`,
        `H ${x + w * 0.78}`,
        `Q ${x + w} ${y + h * 0.14} ${x + w} ${y + h * 0.5}`,
        `Q ${x + w} ${y + h * 0.86} ${x + w * 0.78} ${y + h}`,
        `H ${x + w * 0.12}`,
        `Q ${x} ${y + h * 0.82} ${x} ${y + h * 0.5}`,
        `Q ${x} ${y + h * 0.18} ${x + w * 0.12} ${y}`,
        'Z',
      ].join(' ');
    case 'delay':
      return [
        `M ${x} ${y}`,
        `H ${x + w * 0.6}`,
        `Q ${x + w} ${y + h * 0.16} ${x + w} ${y + h * 0.5}`,
        `Q ${x + w} ${y + h * 0.84} ${x + w * 0.6} ${y + h}`,
        `H ${x}`,
        'Z',
      ].join(' ');
    case 'internal_storage':
      return roundedRectPath(x, y, w, h, Math.max(8, roundness));
    case 'class_box':
      return roundedRectPath(x, y, w, h, Math.max(6, roundness));
    case 'package': {
      const tabW = w * 0.34;
      const tabH = h * 0.24;
      return [
        `M ${x} ${y + tabH}`,
        `V ${y}`,
        `H ${x + tabW}`,
        `V ${y + tabH}`,
        `H ${x + w}`,
        `V ${y + h}`,
        `H ${x}`,
        'Z',
      ].join(' ');
    }
    case 'weak_entity':
      return roundedRectPath(x, y, w, h, Math.max(6, roundness));
    case 'weak_relationship':
      return polygonPath([
        [cx, y],
        [x + w, cy],
        [cx, y + h],
        [x, cy],
      ]);
    case 'component':
      return roundedRectPath(x, y, w, h, Math.max(8, roundness));
    case 'start_state':
      return ellipsePath(x, y, w, h);
    case 'end_state':
      return ellipsePath(x, y, w, h);
    case 'sync_bar':
      return roundedRectPath(x, y, w, h, Math.min(w, h) * 0.18);
    case 'actor': {
      const headR = Math.min(w, h) * 0.14;
      const headCx = cx;
      const headCy = y + h * 0.22;
      return [
        `M ${headCx} ${headCy - headR}`,
        `A ${headR} ${headR} 0 1 1 ${headCx} ${headCy + headR}`,
        `A ${headR} ${headR} 0 1 1 ${headCx} ${headCy - headR}`,
        `M ${headCx} ${headCy + headR}`,
        `L ${headCx} ${y + h * 0.66}`,
        `M ${x + w * 0.24} ${y + h * 0.4}`,
        `L ${x + w * 0.76} ${y + h * 0.4}`,
        `M ${headCx} ${y + h * 0.66}`,
        `L ${x + w * 0.28} ${y + h}`,
        `M ${headCx} ${y + h * 0.66}`,
        `L ${x + w * 0.72} ${y + h}`,
      ].join(' ');
    }
    case 'arrow_left':
      return polygonPath([
        [x, cy],
        [x + w * 0.28, y],
        [x + w * 0.28, y + h * 0.28],
        [x + w, y + h * 0.28],
        [x + w, y + h * 0.72],
        [x + w * 0.28, y + h * 0.72],
        [x + w * 0.28, y + h],
      ]);
    case 'arrow_right':
      return polygonPath([
        [x + w, cy],
        [x + w * 0.72, y],
        [x + w * 0.72, y + h * 0.28],
        [x, y + h * 0.28],
        [x, y + h * 0.72],
        [x + w * 0.72, y + h * 0.72],
        [x + w * 0.72, y + h],
      ]);
    case 'double_arrow':
      return polygonPath([
        [x, cy],
        [x + w * 0.2, y],
        [x + w * 0.2, y + h * 0.28],
        [x + w * 0.8, y + h * 0.28],
        [x + w * 0.8, y],
        [x + w, cy],
        [x + w * 0.8, y + h],
        [x + w * 0.8, y + h * 0.72],
        [x + w * 0.2, y + h * 0.72],
        [x + w * 0.2, y + h],
      ]);
    case 'plus':
      return polygonPath([
        [x + w * 0.34, y],
        [x + w * 0.66, y],
        [x + w * 0.66, y + h * 0.34],
        [x + w, y + h * 0.34],
        [x + w, y + h * 0.66],
        [x + w * 0.66, y + h * 0.66],
        [x + w * 0.66, y + h],
        [x + w * 0.34, y + h],
        [x + w * 0.34, y + h * 0.66],
        [x, y + h * 0.66],
        [x, y + h * 0.34],
        [x + w * 0.34, y + h * 0.34],
      ]);
    default:
      return roundedRectPath(x, y, w, h, roundness);
  }
}

export function createShapePath(
  variant: ShapeVariant,
  x: number,
  y: number,
  width: number,
  height: number,
  roundness = 8,
) {
  return new Path2D(getShapePathData(variant, x, y, width, height, roundness));
}

export function renderShapeDecoration(
  ctx: CanvasRenderingContext2D,
  variant: ShapeVariant,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (variant === 'document') {
    ctx.beginPath();
    ctx.moveTo(x + width * 0.76, y);
    ctx.lineTo(x + width * 0.76, y + height * 0.24);
    ctx.lineTo(x + width, y + height * 0.24);
    ctx.stroke();
    return;
  }

  if (variant === 'multi_document') {
    const offsetX = width * 0.1;
    const offsetY = height * 0.08;
    ctx.beginPath();
    ctx.moveTo(x + offsetX, y + offsetY);
    ctx.lineTo(x + width * 0.78, y + offsetY);
    ctx.lineTo(x + width * 0.9, y + height * 0.2);
    ctx.moveTo(x + width * 0.78, y + offsetY);
    ctx.lineTo(x + width * 0.78, y + height * 0.2);
    ctx.lineTo(x + width * 0.9, y + height * 0.2);
    ctx.stroke();
    return;
  }

  if (variant === 'predefined_process') {
    ctx.beginPath();
    ctx.moveTo(x + width * 0.18, y + height * 0.12);
    ctx.lineTo(x + width * 0.18, y + height * 0.88);
    ctx.moveTo(x + width * 0.82, y + height * 0.12);
    ctx.lineTo(x + width * 0.82, y + height * 0.88);
    ctx.stroke();
    return;
  }

  if (variant === 'internal_storage') {
    ctx.beginPath();
    ctx.moveTo(x + width * 0.18, y);
    ctx.lineTo(x + width * 0.18, y + height);
    ctx.moveTo(x, y + height * 0.2);
    ctx.lineTo(x + width, y + height * 0.2);
    ctx.stroke();
    return;
  }

  if (variant === 'class_box') {
    ctx.beginPath();
    ctx.moveTo(x, y + height * 0.34);
    ctx.lineTo(x + width, y + height * 0.34);
    ctx.moveTo(x, y + height * 0.68);
    ctx.lineTo(x + width, y + height * 0.68);
    ctx.stroke();
    return;
  }

  if (variant === 'package') {
    const tabW = width * 0.34;
    const tabH = height * 0.24;
    ctx.beginPath();
    ctx.moveTo(x, y + tabH);
    ctx.lineTo(x + tabW, y + tabH);
    ctx.lineTo(x + tabW, y);
    ctx.stroke();
    return;
  }

  if (variant === 'weak_entity') {
    const inset = Math.max(Math.min(width, height) * 0.08, 6);
    ctx.strokeRect(x + inset, y + inset, width - inset * 2, height - inset * 2);
    return;
  }

  if (variant === 'weak_relationship') {
    const inset = Math.max(Math.min(width, height) * 0.1, 6);
    ctx.beginPath();
    ctx.moveTo(x + width / 2, y + inset);
    ctx.lineTo(x + width - inset, y + height / 2);
    ctx.lineTo(x + width / 2, y + height - inset);
    ctx.lineTo(x + inset, y + height / 2);
    ctx.closePath();
    ctx.stroke();
    return;
  }

  if (variant === 'component') {
    const tabW = width * 0.12;
    const tabH = height * 0.18;
    const tabX = x + width * 0.76;
    ctx.strokeRect(tabX, y + height * 0.24, tabW, tabH);
    ctx.strokeRect(tabX, y + height * 0.52, tabW, tabH);
    return;
  }

  if (variant === 'end_state') {
    const inset = Math.max(Math.min(width, height) * 0.14, 6);
    ctx.beginPath();
    ctx.ellipse(x + width / 2, y + height / 2, Math.max(width / 2 - inset, 1), Math.max(height / 2 - inset, 1), 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  if (variant === 'cylinder') {
    const ry = Math.min(height * 0.18, 18);
    ctx.beginPath();
    ctx.moveTo(x, y + ry);
    ctx.bezierCurveTo(x, y - ry * 0.2, x + width, y - ry * 0.2, x + width, y + ry);
    ctx.stroke();
  }
}
