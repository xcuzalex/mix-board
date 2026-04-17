use reqwest::Client;
use serde::{Deserialize, Serialize};

const ANTHROPIC_API_VERSION: &str = "2023-06-01";
const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnthropicMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnthropicChatRequest {
    pub model: String,
    pub messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    pub max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AnthropicChatResponse {
    pub id: String,
    pub model: String,
    pub content: Vec<AnthropicContentBlock>,
    pub stop_reason: Option<String>,
    pub usage: AnthropicUsage,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AnthropicContentBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AnthropicUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// Normalise base URL (strip trailing slashes, fall back to default).
fn normalise_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        DEFAULT_ANTHROPIC_BASE_URL.to_string()
    } else {
        trimmed.to_string()
    }
}

pub struct AnthropicClient {
    client: Client,
    base_url: String,
    api_key: String,
}

impl AnthropicClient {
    pub fn new(base_url: String, api_key: String) -> Self {
        Self {
            client: Client::new(),
            base_url: normalise_base_url(&base_url),
            api_key,
        }
    }

    /// Convert generic ChatMessage list into Anthropic format.
    /// System messages are extracted and joined into the `system` parameter.
    pub fn prepare_request(
        messages: &[super::openai::ChatMessage],
        model: &str,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
    ) -> AnthropicChatRequest {
        let mut system_parts: Vec<String> = Vec::new();
        let mut chat_messages: Vec<AnthropicMessage> = Vec::new();

        for msg in messages {
            if msg.role == "system" {
                system_parts.push(msg.content.clone());
            } else {
                chat_messages.push(AnthropicMessage {
                    role: msg.role.clone(),
                    content: msg.content.clone(),
                });
            }
        }

        AnthropicChatRequest {
            model: model.to_string(),
            messages: chat_messages,
            system: if system_parts.is_empty() {
                None
            } else {
                Some(system_parts.join("\n\n"))
            },
            max_tokens: max_tokens.unwrap_or(4096),
            temperature,
        }
    }

    pub async fn chat_completion(
        &self,
        request: AnthropicChatRequest,
    ) -> Result<AnthropicChatResponse, String> {
        let url = format!("{}/v1/messages", self.base_url);
        let response = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic API error ({}): {}", status, text));
        }

        response.json().await.map_err(|e| e.to_string())
    }

    /// Wraps the Anthropic response back into an OpenAI-shaped JSON string
    /// so the frontend can use the same parsing path.
    pub fn to_openai_compat_json(response: &AnthropicChatResponse) -> Result<String, String> {
        let content_text = response
            .content
            .iter()
            .filter(|block| block.block_type == "text")
            .map(|block| block.text.as_str())
            .collect::<Vec<_>>()
            .join("");

        let compat = serde_json::json!({
            "id": response.id,
            "model": response.model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content_text,
                },
                "finish_reason": response.stop_reason,
            }],
            "usage": {
                "prompt_tokens": response.usage.input_tokens,
                "completion_tokens": response.usage.output_tokens,
                "total_tokens": response.usage.input_tokens + response.usage.output_tokens,
            },
        });

        serde_json::to_string(&compat).map_err(|e| e.to_string())
    }

    /// List models via /v1/models endpoint.
    /// Returns a JSON string in the same `{ data: [...] }` shape the frontend expects.
    pub async fn list_models(&self) -> Result<String, String> {
        let url = format!("{}/v1/models", self.base_url);
        let response = self
            .client
            .get(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic API error ({}): {}", status, text));
        }

        response.text().await.map_err(|e| e.to_string())
    }

    pub async fn validate_credentials(&self) -> Result<bool, String> {
        // Send a minimal request to verify the key works.
        let request = AnthropicChatRequest {
            model: "claude-sonnet-4-20250514".to_string(),
            messages: vec![AnthropicMessage {
                role: "user".to_string(),
                content: "Hi".to_string(),
            }],
            system: None,
            max_tokens: 8,
            temperature: None,
        };

        let url = format!("{}/v1/messages", self.base_url);
        let response = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        Ok(response.status().is_success())
    }
}
