export class Viewport {
  x = 0;
  y = 0;
  zoom = 1;

  screenToCanvas(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.x) / this.zoom,
      y: (screenY - this.y) / this.zoom,
    };
  }

  canvasToScreen(canvasX: number, canvasY: number): { x: number; y: number } {
    return {
      x: canvasX * this.zoom + this.x,
      y: canvasY * this.zoom + this.y,
    };
  }

  applyToContext(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(this.zoom, 0, 0, this.zoom, this.x, this.y);
  }

  zoomAtPoint(screenX: number, screenY: number, newZoom: number) {
    const clampedZoom = Math.max(0.1, Math.min(5, newZoom));
    const canvasPoint = this.screenToCanvas(screenX, screenY);
    this.zoom = clampedZoom;
    this.x = screenX - canvasPoint.x * this.zoom;
    this.y = screenY - canvasPoint.y * this.zoom;
  }

  pan(dx: number, dy: number) {
    this.x += dx;
    this.y += dy;
  }

  update(x: number, y: number, zoom: number) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
  }
}
