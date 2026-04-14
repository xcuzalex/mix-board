use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StrokeStyle {
    Solid,
    Dashed,
    Dotted,
}

impl Default for StrokeStyle {
    fn default() -> Self {
        Self::Solid
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FillStyle {
    Solid,
    Hachure,
    CrossHatch,
    None,
}

impl Default for FillStyle {
    fn default() -> Self {
        Self::Solid
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorShape {
    Straight,
    Polyline,
    Curve,
    RightAngledPolyline,
}

impl Default for ConnectorShape {
    fn default() -> Self {
        Self::Straight
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ArrowType {
    None,
    Arrow,
    OpenArrow,
    HollowArrow,
    Diamond,
    HollowDiamond,
    Circle,
    HollowCircle,
    Bar,
    Triangle,
    HollowTriangle,
}

impl Default for ArrowType {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NoteColor {
    Yellow,
    Green,
    Blue,
    Pink,
    Purple,
    Orange,
    Red,
    Gray,
    White,
}

impl Default for NoteColor {
    fn default() -> Self {
        Self::Yellow
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

impl Default for TextAlign {
    fn default() -> Self {
        Self::Left
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VerticalAlign {
    Top,
    Middle,
    Bottom,
}

impl Default for VerticalAlign {
    fn default() -> Self {
        Self::Top
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BoundElement {
    #[serde(rename = "type")]
    pub bound_type: String,
    pub id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub element_id: String,
    pub focus: f64,
    pub gap: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BaseProperties {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub angle: f64,
    #[serde(default = "default_stroke_color")]
    pub stroke_color: String,
    #[serde(default = "default_stroke_width")]
    pub stroke_width: f64,
    #[serde(default)]
    pub stroke_style: StrokeStyle,
    #[serde(default = "default_bg_color")]
    pub background_color: String,
    #[serde(default)]
    pub fill_style: FillStyle,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default)]
    pub group_ids: Vec<String>,
    #[serde(default)]
    pub frame_id: Option<String>,
    #[serde(default)]
    pub bound_elements: Vec<BoundElement>,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

fn default_stroke_color() -> String {
    "#1B1B1F".to_string()
}
fn default_stroke_width() -> f64 {
    2.0
}
fn default_bg_color() -> String {
    "transparent".to_string()
}
fn default_opacity() -> f64 {
    100.0
}

impl BaseProperties {
    pub fn new(id: String, x: f64, y: f64, width: f64, height: f64) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        Self {
            id,
            x,
            y,
            width,
            height,
            angle: 0.0,
            stroke_color: default_stroke_color(),
            stroke_width: default_stroke_width(),
            stroke_style: StrokeStyle::default(),
            background_color: default_bg_color(),
            fill_style: FillStyle::Solid,
            opacity: 100.0,
            group_ids: Vec::new(),
            frame_id: None,
            bound_elements: Vec::new(),
            locked: false,
            z_index: 0,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum Element {
    #[serde(rename = "rectangle")]
    Rectangle {
        #[serde(flatten)]
        base: BaseProperties,
        #[serde(default)]
        roundness: f64,
    },
    #[serde(rename = "ellipse")]
    Ellipse {
        #[serde(flatten)]
        base: BaseProperties,
    },
    #[serde(rename = "diamond")]
    Diamond {
        #[serde(flatten)]
        base: BaseProperties,
    },
    #[serde(rename = "triangle")]
    Triangle {
        #[serde(flatten)]
        base: BaseProperties,
    },
    #[serde(rename = "line")]
    Line {
        #[serde(flatten)]
        base: BaseProperties,
        #[serde(default, rename = "connectorShape")]
        connector_shape: ConnectorShape,
        #[serde(default)]
        points: Vec<[f64; 2]>,
        #[serde(default, rename = "startBinding")]
        start_binding: Option<Binding>,
        #[serde(default, rename = "endBinding")]
        end_binding: Option<Binding>,
        #[serde(default, rename = "startArrowType")]
        start_arrow_type: ArrowType,
        #[serde(default, rename = "endArrowType")]
        end_arrow_type: ArrowType,
    },
    #[serde(rename = "arrow")]
    Arrow {
        #[serde(flatten)]
        base: BaseProperties,
        #[serde(default, rename = "connectorShape")]
        connector_shape: ConnectorShape,
        #[serde(default)]
        points: Vec<[f64; 2]>,
        #[serde(default, rename = "startBinding")]
        start_binding: Option<Binding>,
        #[serde(default, rename = "endBinding")]
        end_binding: Option<Binding>,
        #[serde(default = "default_arrow_end", rename = "startArrowType")]
        start_arrow_type: ArrowType,
        #[serde(default = "default_arrow_end", rename = "endArrowType")]
        end_arrow_type: ArrowType,
    },
    #[serde(rename = "text")]
    Text {
        #[serde(flatten)]
        base: BaseProperties,
        #[serde(default)]
        text: String,
        #[serde(default = "default_font_size", rename = "fontSize")]
        font_size: f64,
        #[serde(default = "default_font_family", rename = "fontFamily")]
        font_family: String,
        #[serde(default, rename = "textAlign")]
        text_align: TextAlign,
        #[serde(default, rename = "verticalAlign")]
        vertical_align: VerticalAlign,
        #[serde(default, rename = "containerId")]
        container_id: Option<String>,
    },
    #[serde(rename = "freedraw")]
    Freedraw {
        #[serde(flatten)]
        base: BaseProperties,
        #[serde(default)]
        points: Vec<[f64; 2]>,
        #[serde(default)]
        pressures: Vec<f64>,
    },
    #[serde(rename = "highlighter")]
    Highlighter {
        #[serde(flatten)]
        base: BaseProperties,
        #[serde(default)]
        points: Vec<[f64; 2]>,
        #[serde(default)]
        pressures: Vec<f64>,
        #[serde(default = "default_highlight_color", rename = "highlightColor")]
        highlight_color: String,
    },
    #[serde(rename = "sticky_note")]
    StickyNote {
        #[serde(flatten)]
        base: BaseProperties,
        #[serde(default)]
        text: String,
        #[serde(default = "default_font_size", rename = "fontSize")]
        font_size: f64,
        #[serde(default, rename = "noteColor")]
        note_color: NoteColor,
    },
    #[serde(rename = "mindmap")]
    Mindmap {
        #[serde(flatten)]
        base: BaseProperties,
        layout: crate::mindmap::MindmapLayout,
        #[serde(default = "default_branch_style", rename = "branchStyle")]
        branch_style: crate::mindmap::BranchStyle,
        #[serde(default, rename = "lineStyle")]
        line_style: crate::mindmap::LineStyleConfig,
        #[serde(rename = "rootNode")]
        root_node: crate::mindmap::MindmapNode,
    },
    #[serde(rename = "image")]
    Image {
        #[serde(flatten)]
        base: BaseProperties,
        #[serde(rename = "fileId")]
        file_id: String,
        #[serde(default = "default_scale")]
        scale: [f64; 2],
    },
    #[serde(rename = "section")]
    Section {
        #[serde(flatten)]
        base: BaseProperties,
        #[serde(default)]
        title: String,
        #[serde(default)]
        #[serde(rename = "childElementIds")]
        child_element_ids: Vec<String>,
    },
    #[serde(rename = "frame")]
    Frame {
        #[serde(flatten)]
        base: BaseProperties,
        #[serde(default)]
        title: String,
        #[serde(default)]
        #[serde(rename = "childElementIds")]
        child_element_ids: Vec<String>,
    },
    #[serde(rename = "table")]
    Table {
        #[serde(flatten)]
        base: BaseProperties,
        rows: usize,
        columns: usize,
        cells: Vec<Vec<TableCell>>,
        #[serde(rename = "columnWidths")]
        column_widths: Vec<f64>,
        #[serde(rename = "rowHeights")]
        row_heights: Vec<f64>,
    },
}

fn default_arrow_end() -> ArrowType {
    ArrowType::Arrow
}
fn default_font_size() -> f64 {
    20.0
}
fn default_font_family() -> String {
    "Inter".to_string()
}
fn default_highlight_color() -> String {
    "rgba(255, 235, 59, 0.4)".to_string()
}
fn default_branch_style() -> crate::mindmap::BranchStyle {
    crate::mindmap::BranchStyle::Curve
}
fn default_scale() -> [f64; 2] {
    [1.0, 1.0]
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TableCell {
    #[serde(default)]
    pub text: String,
    #[serde(default = "default_bg_color")]
    pub background_color: String,
    #[serde(default = "default_stroke_color")]
    pub text_color: String,
    #[serde(default = "default_font_size")]
    pub font_size: f64,
    #[serde(default)]
    pub text_align: TextAlign,
    #[serde(default)]
    pub font_weight: FontWeight,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum FontWeight {
    #[default]
    Normal,
    Bold,
}

impl Element {
    pub fn base(&self) -> &BaseProperties {
        match self {
            Element::Rectangle { base, .. }
            | Element::Ellipse { base, .. }
            | Element::Diamond { base, .. }
            | Element::Triangle { base, .. }
            | Element::Line { base, .. }
            | Element::Arrow { base, .. }
            | Element::Text { base, .. }
            | Element::Freedraw { base, .. }
            | Element::Highlighter { base, .. }
            | Element::StickyNote { base, .. }
            | Element::Mindmap { base, .. }
            | Element::Image { base, .. }
            | Element::Section { base, .. }
            | Element::Frame { base, .. }
            | Element::Table { base, .. } => base,
        }
    }

    pub fn base_mut(&mut self) -> &mut BaseProperties {
        match self {
            Element::Rectangle { base, .. }
            | Element::Ellipse { base, .. }
            | Element::Diamond { base, .. }
            | Element::Triangle { base, .. }
            | Element::Line { base, .. }
            | Element::Arrow { base, .. }
            | Element::Text { base, .. }
            | Element::Freedraw { base, .. }
            | Element::Highlighter { base, .. }
            | Element::StickyNote { base, .. }
            | Element::Mindmap { base, .. }
            | Element::Image { base, .. }
            | Element::Section { base, .. }
            | Element::Frame { base, .. }
            | Element::Table { base, .. } => base,
        }
    }

    pub fn id(&self) -> &str {
        &self.base().id
    }
}
