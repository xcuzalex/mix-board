use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_format: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub model: String,
    pub choices: Vec<ChatChoice>,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChoice {
    pub index: u32,
    pub message: ChatMessage,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub owned_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelList {
    pub data: Vec<Model>,
}

pub struct OpenAiClient {
    client: Client,
    base_url: String,
    api_key: String,
    /// Path prefix before `/chat/completions` and `/models`.
    /// OpenAI / OpenRouter use "/v1", Kilo uses "" (empty).
    path_prefix: String,
}

impl OpenAiClient {
    pub fn new(base_url: String, api_key: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(90))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            client,
            base_url,
            api_key,
            path_prefix: "/v1".to_string(),
        }
    }

    pub fn with_path_prefix(mut self, prefix: &str) -> Self {
        self.path_prefix = prefix.to_string();
        self
    }

    pub async fn chat_completion(
        &self,
        request: ChatCompletionRequest,
    ) -> Result<ChatCompletionResponse, String> {
        let url = format!("{}{}/chat/completions", self.base_url, self.path_prefix);
        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("API error ({}): {}", status, text));
        }

        response
            .json()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_models(&self) -> Result<ModelList, String> {
        let raw = self.list_models_raw().await?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())
    }

    /// Returns the raw JSON string from the models endpoint.
    /// Use this when the response may not match the strict OpenAI Model schema
    /// (e.g. Kilo, OpenRouter return extra/different fields).
    pub async fn list_models_raw(&self) -> Result<String, String> {
        let url = format!("{}{}/models", self.base_url, self.path_prefix);
        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("API error ({}): {}", status, text));
        }

        response.text().await.map_err(|e| e.to_string())
    }

    /// Send a chat completion and return the raw JSON string without typed deserialization.
    /// Useful when the provider response doesn't exactly match `ChatCompletionResponse`.
    pub async fn chat_completion_raw(
        &self,
        request: ChatCompletionRequest,
    ) -> Result<String, String> {
        let url = format!("{}{}/chat/completions", self.base_url, self.path_prefix);
        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("API error ({}): {}", status, text));
        }

        response.text().await.map_err(|e| e.to_string())
    }

    pub async fn validate_credentials(&self) -> Result<bool, String> {
        let raw = self.list_models_raw().await?;
        // Just check that we got a valid JSON with a non-empty data array
        let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let has_models = value.get("data")
            .and_then(|d| d.as_array())
            .is_some_and(|a| !a.is_empty());
        Ok(has_models)
    }
}
