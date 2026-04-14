use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::element::Element;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    #[serde(rename = "type")]
    pub doc_type: String,
    pub version: u32,
    pub source: String,
    pub elements: Vec<Element>,
    #[serde(default)]
    pub app_state: AppState,
    #[serde(default)]
    pub files: HashMap<String, EmbeddedFile>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    #[serde(default = "default_bg")]
    pub view_background_color: String,
    #[serde(default)]
    pub grid_enabled: bool,
    #[serde(default = "default_grid_size")]
    pub grid_size: f64,
}

fn default_bg() -> String {
    "#ffffff".to_string()
}
fn default_grid_size() -> f64 {
    20.0
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            view_background_color: default_bg(),
            grid_enabled: false,
            grid_size: default_grid_size(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedFile {
    pub id: String,
    pub mime_type: String,
    pub data_url: String,
    pub created: u64,
}

impl Document {
    pub fn new() -> Self {
        Self {
            doc_type: "mixboard".to_string(),
            version: 1,
            source: "MixBoard/0.1.0".to_string(),
            elements: Vec::new(),
            app_state: AppState::default(),
            files: HashMap::new(),
        }
    }

    pub fn add_element(&mut self, element: Element) {
        self.elements.push(element);
    }

    pub fn remove_element(&mut self, id: &str) -> Option<Element> {
        if let Some(pos) = self.elements.iter().position(|e| e.id() == id) {
            Some(self.elements.remove(pos))
        } else {
            None
        }
    }

    pub fn find_element(&self, id: &str) -> Option<&Element> {
        self.elements.iter().find(|e| e.id() == id)
    }

    pub fn find_element_mut(&mut self, id: &str) -> Option<&mut Element> {
        self.elements.iter_mut().find(|e| e.id() == id)
    }
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}
