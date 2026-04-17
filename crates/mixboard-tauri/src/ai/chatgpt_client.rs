use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const CHATGPT_API_BASE: &str = "https://chatgpt.com/backend-api";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatGPTMessage {
    pub id: String,
    pub author: ChatGPTMessageAuthor,
    pub content: ChatGPTMessageContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatGPTMessageAuthor {
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatGPTMessageContent {
    pub content_type: String,
    pub parts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationRequest {
    pub action: String,
    pub messages: Vec<ChatGPTMessage>,
    pub model: String,
    pub parent_message_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_mode: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_nulligen: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_paragen: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_rate_limit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_rate_limits: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supported_encodings: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history_and_training_disabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSSEMessage {
    pub message: Option<ConversationMessageData>,
    pub conversation_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessageData {
    pub id: Option<String>,
    pub author: Option<ChatGPTMessageAuthor>,
    pub content: Option<ChatGPTMessageContent>,
    pub status: Option<String>,
    pub metadata: Option<Value>,
}

pub struct ChatGPTWebClient {
    client: Client,
    access_token: String,
}

impl ChatGPTWebClient {
    pub fn new(access_token: String) -> Self {
        Self {
            client: Client::builder()
                .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .build()
                .unwrap_or_else(|_| Client::new()),
            access_token,
        }
    }

    pub async fn conversation(
        &self,
        messages: Vec<super::openai::ChatMessage>,
        model: String,
    ) -> Result<String, String> {
        let parent_message_id = uuid::Uuid::new_v4().to_string();

        let chatgpt_messages: Vec<ChatGPTMessage> = messages
            .into_iter()
            .map(|msg| ChatGPTMessage {
                id: uuid::Uuid::new_v4().to_string(),
                author: ChatGPTMessageAuthor { role: msg.role },
                content: ChatGPTMessageContent {
                    content_type: "text".to_string(),
                    parts: vec![msg.content],
                },
                metadata: None,
            })
            .collect();

        let request = ConversationRequest {
            action: "next".to_string(),
            messages: chatgpt_messages,
            model,
            parent_message_id,
            conversation_id: None,
            conversation_mode: Some(serde_json::json!({"kind": "primary_assistant"})),
            force_nulligen: Some(false),
            force_paragen: Some(false),
            force_rate_limit: Some(false),
            reset_rate_limits: Some(false),
            supported_encodings: Some(serde_json::json!({
                "default": "utf-8",
                "compress": "gzip"
            })),
            history_and_training_disabled: Some(false),
        };

        let url = format!("{}/conversation", CHATGPT_API_BASE);
        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .header("oai-language", "zh-Hans")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("ChatGPT API request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("ChatGPT API error ({}): {}", status, text));
        }

        let mut stream = response.bytes_stream();
        let mut last_parts: Vec<String> = Vec::new();

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| format!("Stream read error: {}", e))?;
            let chunk_str = String::from_utf8_lossy(&chunk);

            for line in chunk_str.lines() {
                let line = line.trim();
                if !line.starts_with("data: ") {
                    continue;
                }

                let data = &line[6..];
                if data == "[DONE]" {
                    break;
                }

                let parsed: Result<ConversationSSEMessage, _> = serde_json::from_str(data);
                if let Ok(msg) = parsed {
                    if let Some(error) = msg.error {
                        return Err(format!("ChatGPT API error: {}", error));
                    }

                    if let Some(message) = msg.message {
                        if let Some(content) = message.content {
                            if !content.parts.is_empty() {
                                last_parts = content.parts;
                            }
                        }
                    }
                }
            }
        }

        let accumulated_text = last_parts.join("");
        if accumulated_text.is_empty() {
            return Err("ChatGPT \u{672A}\u{8FD4}\u{56DE}\u{6709}\u{6548}\u{5185}\u{5BB9}".to_string());
        }

        let response_json = serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "model": "chatgpt-web",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": accumulated_text
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0
            }
        });

        serde_json::to_string(&response_json).map_err(|e| e.to_string())
    }

    pub async fn validate_token(&self) -> Result<bool, String> {
        let url = format!("{}/me", CHATGPT_API_BASE);
        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .send()
            .await
            .map_err(|e| format!("Validation request failed: {}", e))?;

        Ok(response.status().is_success())
    }
}