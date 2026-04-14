#[derive(Clone, Debug)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn point_in_rect(px: f64, py: f64, rect: &Rect) -> bool {
    px >= rect.x
        && px <= rect.x + rect.width
        && py >= rect.y
        && py <= rect.y + rect.height
}

pub fn point_in_ellipse(px: f64, py: f64, cx: f64, cy: f64, rx: f64, ry: f64) -> bool {
    if rx <= 0.0 || ry <= 0.0 {
        return false;
    }
    let dx = px - cx;
    let dy = py - cy;
    (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1.0
}

pub fn point_to_segment_distance(px: f64, py: f64, x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let len_sq = dx * dx + dy * dy;

    if len_sq == 0.0 {
        return ((px - x1).powi(2) + (py - y1).powi(2)).sqrt();
    }

    let t = ((px - x1) * dx + (py - y1) * dy) / len_sq;
    let t = t.clamp(0.0, 1.0);

    let proj_x = x1 + t * dx;
    let proj_y = y1 + t * dy;

    ((px - proj_x).powi(2) + (py - proj_y).powi(2)).sqrt()
}

pub fn rect_intersects(a: &Rect, b: &Rect) -> bool {
    a.x < b.x + b.width
        && a.x + a.width > b.x
        && a.y < b.y + b.height
        && a.y + a.height > b.y
}

pub fn point_in_rotated_rect(px: f64, py: f64, rect: &Rect, angle: f64) -> bool {
    let cx = rect.x + rect.width / 2.0;
    let cy = rect.y + rect.height / 2.0;

    let cos_a = (-angle).cos();
    let sin_a = (-angle).sin();
    let dx = px - cx;
    let dy = py - cy;
    let rx = dx * cos_a - dy * sin_a + cx;
    let ry = dx * sin_a + dy * cos_a + cy;

    point_in_rect(rx, ry, rect)
}

pub fn point_in_diamond(px: f64, py: f64, rect: &Rect) -> bool {
    let cx = rect.x + rect.width / 2.0;
    let cy = rect.y + rect.height / 2.0;
    let half_w = rect.width / 2.0;
    let half_h = rect.height / 2.0;

    if half_w <= 0.0 || half_h <= 0.0 {
        return false;
    }

    let dx = (px - cx).abs();
    let dy = (py - cy).abs();
    dx / half_w + dy / half_h <= 1.0
}

pub fn distance(x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt()
}
