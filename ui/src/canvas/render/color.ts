/** `#rrggbb` → `rgba(r, g, b, alpha)`; other colour strings are returned unchanged. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Solid `#rrggbb` of `top` painted at `alpha` over `base` (both `#rrggbb`). */
export function blendOver(base: string, top: string, alpha: number): string {
  const parse = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = parse(base);
  const b = parse(top);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * alpha).toString(16).padStart(2, '0')).join('')}`;
}
