use crate::document::Document;

pub fn serialize(doc: &Document) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(doc)
}

pub fn deserialize(json: &str) -> Result<Document, serde_json::Error> {
    serde_json::from_str(json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{BaseProperties, Element};

    #[test]
    fn test_roundtrip() {
        let mut doc = Document::new();
        doc.add_element(Element::Rectangle {
            base: BaseProperties::new("rect_001".to_string(), 100.0, 100.0, 200.0, 120.0),
            roundness: 8.0,
        });

        let json = serialize(&doc).unwrap();
        let doc2 = deserialize(&json).unwrap();

        assert_eq!(doc2.elements.len(), 1);
        assert_eq!(doc2.elements[0].id(), "rect_001");
    }

    #[test]
    fn test_file_format() {
        let json = r##"{
            "type": "mixboard",
            "version": 1,
            "source": "MixBoard/0.1.0",
            "elements": [
                {
                    "type": "rectangle",
                    "id": "test",
                    "x": 0, "y": 0, "width": 100, "height": 100,
                    "roundness": 4
                }
            ],
            "appState": {
                "viewBackgroundColor": "#ffffff",
                "gridEnabled": false,
                "gridSize": 20
            }
        }"##;
        let doc = deserialize(json).unwrap();
        assert_eq!(doc.elements.len(), 1);
    }
}
