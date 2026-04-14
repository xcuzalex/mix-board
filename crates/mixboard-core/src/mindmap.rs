use serde::{Deserialize, Serialize};

use crate::element::StrokeStyle;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MindmapLayout {
    MindmapLr,
    MindmapRight,
    MindmapLeft,
    TreeDown,
    TreeRight,
    OrgChart,
    Timeline,
}

impl Default for MindmapLayout {
    fn default() -> Self {
        Self::MindmapRight
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BranchStyle {
    Curve,
    Polyline,
}

impl Default for BranchStyle {
    fn default() -> Self {
        Self::Curve
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MindmapNodeType {
    Root,
    Branch,
    Leaf,
}

impl Default for MindmapNodeType {
    fn default() -> Self {
        Self::Leaf
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NodeShape {
    Text,
    RoundedRect,
    Pill,
}

impl Default for NodeShape {
    fn default() -> Self {
        Self::RoundedRect
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LineStyleConfig {
    #[serde(default = "default_line_color")]
    pub color: String,
    #[serde(default = "default_line_width")]
    pub width: f64,
    #[serde(default)]
    pub style: StrokeStyle,
}

fn default_line_color() -> String {
    "#999999".to_string()
}
fn default_line_width() -> f64 {
    2.0
}

impl Default for LineStyleConfig {
    fn default() -> Self {
        Self {
            color: default_line_color(),
            width: default_line_width(),
            style: StrokeStyle::Solid,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MindmapNode {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub node_type: MindmapNodeType,
    #[serde(default)]
    pub node_shape: NodeShape,
    #[serde(default = "default_node_bg")]
    pub background_color: String,
    #[serde(default = "default_node_text_color")]
    pub text_color: String,
    #[serde(default = "default_node_font_size")]
    pub font_size: f64,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub image_file_id: Option<String>,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub children: Vec<MindmapNode>,
    #[serde(default)]
    pub left_children: Vec<MindmapNode>,
    #[serde(default)]
    pub right_children: Vec<MindmapNode>,

    // Layout computed positions (not serialized to file)
    #[serde(skip)]
    pub layout_x: f64,
    #[serde(skip)]
    pub layout_y: f64,
    #[serde(skip)]
    pub layout_width: f64,
    #[serde(skip)]
    pub layout_height: f64,
}

fn default_node_bg() -> String {
    "#E3F2FD".to_string()
}
fn default_node_text_color() -> String {
    "#1B1B1F".to_string()
}
fn default_node_font_size() -> f64 {
    16.0
}

impl MindmapNode {
    pub fn new(id: String, text: String, node_type: MindmapNodeType) -> Self {
        Self {
            id,
            text,
            description: None,
            node_type,
            node_shape: NodeShape::RoundedRect,
            background_color: default_node_bg(),
            text_color: default_node_text_color(),
            font_size: default_node_font_size(),
            icon: None,
            image_file_id: None,
            collapsed: false,
            children: Vec::new(),
            left_children: Vec::new(),
            right_children: Vec::new(),
            layout_x: 0.0,
            layout_y: 0.0,
            layout_width: 0.0,
            layout_height: 0.0,
        }
    }
}

pub fn find_node<'a>(root: &'a MindmapNode, id: &str) -> Option<&'a MindmapNode> {
    if root.id == id {
        return Some(root);
    }
    for child in root
        .children
        .iter()
        .chain(root.left_children.iter())
        .chain(root.right_children.iter())
    {
        if let Some(found) = find_node(child, id) {
            return Some(found);
        }
    }
    None
}

pub fn find_node_mut<'a>(root: &'a mut MindmapNode, id: &str) -> Option<&'a mut MindmapNode> {
    if root.id == id {
        return Some(root);
    }
    for child in root
        .children
        .iter_mut()
        .chain(root.left_children.iter_mut())
        .chain(root.right_children.iter_mut())
    {
        if let Some(found) = find_node_mut(child, id) {
            return Some(found);
        }
    }
    None
}

pub fn insert_child(root: &mut MindmapNode, parent_id: &str, new_id: String) -> bool {
    if let Some(parent) = find_node_mut(root, parent_id) {
        let child = MindmapNode::new(new_id, "New Node".to_string(), MindmapNodeType::Leaf);
        parent.children.push(child);
        true
    } else {
        false
    }
}

pub fn remove_node(root: &mut MindmapNode, target_id: &str) -> bool {
    fn remove_from_list(list: &mut Vec<MindmapNode>, id: &str) -> bool {
        if let Some(pos) = list.iter().position(|n| n.id == id) {
            list.remove(pos);
            return true;
        }
        for child in list.iter_mut() {
            if remove_node(child, id) {
                return true;
            }
        }
        false
    }

    remove_from_list(&mut root.children, target_id)
        || remove_from_list(&mut root.left_children, target_id)
        || remove_from_list(&mut root.right_children, target_id)
}

/// Auto-layout entry point (Reingold-Tilford variant)
pub fn layout_mindmap(
    root: &mut MindmapNode,
    layout: &MindmapLayout,
    h_gap: f64,
    v_gap: f64,
    measure_fn: &dyn Fn(&str, f64) -> (f64, f64),
) {
    measure_node_sizes(root, measure_fn);
    match layout {
        MindmapLayout::MindmapRight => layout_horizontal(root, 0.0, 0.0, h_gap, v_gap, false),
        MindmapLayout::MindmapLeft => layout_horizontal(root, 0.0, 0.0, h_gap, v_gap, true),
        MindmapLayout::MindmapLr => layout_lr(root, h_gap, v_gap),
        MindmapLayout::TreeDown => layout_vertical(root, 0.0, 0.0, h_gap, v_gap),
        MindmapLayout::TreeRight => layout_horizontal(root, 0.0, 0.0, h_gap, v_gap, false),
        MindmapLayout::OrgChart => layout_vertical(root, 0.0, 0.0, h_gap, v_gap),
        MindmapLayout::Timeline => layout_horizontal(root, 0.0, 0.0, h_gap, v_gap, false),
    }
}

fn measure_node_sizes(
    node: &mut MindmapNode,
    measure_fn: &dyn Fn(&str, f64) -> (f64, f64),
) {
    let (w, h) = measure_fn(&node.text, node.font_size);
    let padding = 24.0;
    node.layout_width = w + padding;
    node.layout_height = h + padding;
    for child in node
        .children
        .iter_mut()
        .chain(node.left_children.iter_mut())
        .chain(node.right_children.iter_mut())
    {
        measure_node_sizes(child, measure_fn);
    }
}

fn subtree_height(node: &MindmapNode, v_gap: f64) -> f64 {
    if node.collapsed || node.children.is_empty() {
        return node.layout_height;
    }
    let children_height: f64 = node
        .children
        .iter()
        .map(|c| subtree_height(c, v_gap))
        .sum::<f64>()
        + (node.children.len() as f64 - 1.0) * v_gap;
    children_height.max(node.layout_height)
}

fn layout_horizontal(
    node: &mut MindmapNode,
    x: f64,
    y: f64,
    h_gap: f64,
    v_gap: f64,
    left: bool,
) {
    node.layout_x = x;
    let total_h = subtree_height(node, v_gap);
    node.layout_y = y + (total_h - node.layout_height) / 2.0;

    if node.collapsed || node.children.is_empty() {
        return;
    }

    let child_x = if left {
        x - h_gap - node.children.first().map_or(100.0, |c| c.layout_width)
    } else {
        x + node.layout_width + h_gap
    };

    let mut current_y = y;
    // We need to iterate with index to satisfy borrow checker
    let len = node.children.len();
    for i in 0..len {
        let child_h = subtree_height(&node.children[i], v_gap);
        let child = &mut node.children[i];
        layout_horizontal(child, child_x, current_y, h_gap, v_gap, left);
        current_y += child_h + v_gap;
        // For left layout, recalc x for each child based on its own width
        let _ = len; // keep len alive
    }
}

fn layout_lr(node: &mut MindmapNode, h_gap: f64, v_gap: f64) {
    node.layout_x = 0.0;
    node.layout_y = 0.0;

    // Layout right children
    if !node.right_children.is_empty() {
        let right_x = node.layout_width + h_gap;
        let total_h: f64 = node
            .right_children
            .iter()
            .map(|c| subtree_height(c, v_gap))
            .sum::<f64>()
            + (node.right_children.len() as f64 - 1.0) * v_gap;
        let start_y = -(total_h / 2.0) + node.layout_height / 2.0;
        let mut cy = start_y;
        for child in node.right_children.iter_mut() {
            let ch = subtree_height(child, v_gap);
            layout_horizontal(child, right_x, cy, h_gap, v_gap, false);
            cy += ch + v_gap;
        }
    }

    // Layout left children
    if !node.left_children.is_empty() {
        let total_h: f64 = node
            .left_children
            .iter()
            .map(|c| subtree_height(c, v_gap))
            .sum::<f64>()
            + (node.left_children.len() as f64 - 1.0) * v_gap;
        let start_y = -(total_h / 2.0) + node.layout_height / 2.0;
        let mut cy = start_y;
        for child in node.left_children.iter_mut() {
            let ch = subtree_height(child, v_gap);
            let left_x = -(h_gap + child.layout_width);
            layout_horizontal(child, left_x, cy, h_gap, v_gap, true);
            cy += ch + v_gap;
        }
    }

    // Also layout regular children to the right
    if !node.children.is_empty() {
        let right_x = node.layout_width + h_gap;
        let total_h: f64 = node
            .children
            .iter()
            .map(|c| subtree_height(c, v_gap))
            .sum::<f64>()
            + (node.children.len() as f64 - 1.0) * v_gap;
        let start_y = -(total_h / 2.0) + node.layout_height / 2.0;
        let mut cy = start_y;
        for child in node.children.iter_mut() {
            let ch = subtree_height(child, v_gap);
            layout_horizontal(child, right_x, cy, h_gap, v_gap, false);
            cy += ch + v_gap;
        }
    }
}

fn layout_vertical(node: &mut MindmapNode, x: f64, y: f64, h_gap: f64, v_gap: f64) {
    node.layout_x = x;
    node.layout_y = y;

    if node.collapsed || node.children.is_empty() {
        return;
    }

    let child_y = y + node.layout_height + v_gap;
    let total_w: f64 = node
        .children
        .iter()
        .map(|c| c.layout_width)
        .sum::<f64>()
        + (node.children.len() as f64 - 1.0) * h_gap;
    let start_x = x + (node.layout_width - total_w) / 2.0;

    let mut cx = start_x;
    for child in node.children.iter_mut() {
        layout_vertical(child, cx, child_y, h_gap, v_gap);
        cx += child.layout_width + h_gap;
    }
}
