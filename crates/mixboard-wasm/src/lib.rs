use wasm_bindgen::prelude::*;
use mixboard_core::document::Document;
use mixboard_core::serialization;

#[wasm_bindgen]
pub struct WasmDocument {
    inner: Document,
}

#[wasm_bindgen]
impl WasmDocument {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Document::new(),
        }
    }

    #[wasm_bindgen(js_name = "fromJson")]
    pub fn from_json(json: &str) -> Result<WasmDocument, JsValue> {
        let doc = serialization::deserialize(json)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(Self { inner: doc })
    }

    #[wasm_bindgen(js_name = "toJson")]
    pub fn to_json(&self) -> Result<String, JsValue> {
        serialization::serialize(&self.inner)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = "addElement")]
    pub fn add_element(&mut self, element_json: &str) -> Result<(), JsValue> {
        let element: mixboard_core::element::Element = serde_json::from_str(element_json)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.inner.add_element(element);
        Ok(())
    }

    #[wasm_bindgen(js_name = "removeElement")]
    pub fn remove_element(&mut self, id: &str) -> bool {
        self.inner.remove_element(id).is_some()
    }

    #[wasm_bindgen(js_name = "getElements")]
    pub fn get_elements(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.elements)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = "elementCount")]
    pub fn element_count(&self) -> usize {
        self.inner.elements.len()
    }
}

impl Default for WasmDocument {
    fn default() -> Self {
        Self::new()
    }
}
