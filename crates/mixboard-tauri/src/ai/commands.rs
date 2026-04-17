use super::anthropic::AnthropicClient;
use super::chatgpt_auth;
use super::chatgpt_client::ChatGPTWebClient;
use super::openai::{ChatCompletionRequest, ChatMessage, ModelList, OpenAiClient};
use super::secret_store;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Legacy OpenAI-only credential commands (kept for backwards compat)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn has_ai_credentials() -> bool {
    secret_store::has_ai_credentials()
}

#[tauri::command]
pub fn get_ai_base_url() -> Result<String, String> {
    let creds = secret_store::get_ai_credentials()?;
    Ok(creds.base_url)
}

#[tauri::command]
pub fn set_ai_credentials(api_key: String, base_url: String) -> Result<(), String> {
    secret_store::save_ai_credentials(&api_key, &base_url)
}

#[tauri::command]
pub fn clear_ai_credentials() -> Result<(), String> {
    secret_store::clear_ai_credentials()
}

#[tauri::command]
pub async fn validate_ai_credentials() -> Result<bool, String> {
    let creds = secret_store::get_ai_credentials()?;
    let client = OpenAiClient::new(creds.base_url, creds.api_key);
    client.validate_credentials().await
}

#[tauri::command]
pub async fn list_ai_models() -> Result<ModelList, String> {
    let creds = secret_store::get_ai_credentials()?;
    let client = OpenAiClient::new(creds.base_url, creds.api_key);
    client.list_models().await
}

// ---------------------------------------------------------------------------
// Multi-provider credential commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn has_provider_credentials(provider: String) -> bool {
    secret_store::has_provider_credentials(&provider)
}

#[tauri::command]
pub fn get_provider_base_url(provider: String) -> Result<String, String> {
    secret_store::get_provider_base_url(&provider)
}

#[tauri::command]
pub fn set_provider_credentials(
    provider: String,
    api_key: String,
    base_url: String,
) -> Result<(), String> {
    secret_store::save_provider_credentials(&provider, &api_key, &base_url)
}

#[tauri::command]
pub fn clear_provider_credentials(provider: String) -> Result<(), String> {
    secret_store::clear_provider_credentials(&provider)
}

#[tauri::command]
pub async fn validate_provider_credentials(provider: String) -> Result<bool, String> {
    let creds = secret_store::get_provider_credentials(&provider)?;
    match provider.as_str() {
        "openai" | "openrouter" => {
            let client = OpenAiClient::new(creds.base_url, creds.api_key);
            client.validate_credentials().await
        }
        "kilo" => {
            // Kilo /models is public, so we validate via a minimal chat completion.
            // Use chat_completion_raw to avoid strict deserialization failures.
            let client = OpenAiClient::new(creds.base_url, creds.api_key)
                .with_path_prefix("");
            let request = ChatCompletionRequest {
                model: "kilo-auto/free".to_string(),
                messages: vec![ChatMessage {
                    role: "user".to_string(),
                    content: "hi".to_string(),
                }],
                stream: Some(false),
                temperature: None,
                max_tokens: Some(1),
                response_format: None,
            };
            match client.chat_completion_raw(request).await {
                Ok(_) => Ok(true),
                Err(e) if e.contains("401") || e.contains("403") => Ok(false),
                Err(e) => Err(e),
            }
        }
        "anthropic" => {
            let client = AnthropicClient::new(creds.base_url, creds.api_key);
            client.validate_credentials().await
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

// ---------------------------------------------------------------------------
// Multi-provider model listing
// ---------------------------------------------------------------------------

/// Returns raw JSON from each provider's model list endpoint.
/// The frontend parses the provider-specific format itself.
///
/// For providers with public model endpoints (Kilo, OpenRouter), credentials
/// are optional — we fall back to the default base URL with an empty API key.
/// For private endpoints (OpenAI, Anthropic), saved credentials are required.
#[tauri::command]
pub async fn list_provider_models(provider: String, base_url: Option<String>) -> Result<String, String> {
    match provider.as_str() {
        // Public model endpoints — credentials optional
        "kilo" => {
            let url = base_url.unwrap_or_else(|| "https://api.kilo.ai/api/gateway".to_string());
            let api_key = secret_store::get_provider_credentials("kilo")
                .map(|c| c.api_key)
                .unwrap_or_default();
            let client = OpenAiClient::new(url, api_key).with_path_prefix("");
            client.list_models_raw().await
        }
        "openrouter" => {
            let url = base_url.unwrap_or_else(|| "https://openrouter.ai/api".to_string());
            let api_key = secret_store::get_provider_credentials("openrouter")
                .map(|c| c.api_key)
                .unwrap_or_default();
            let client = OpenAiClient::new(url, api_key);
            client.list_models_raw().await
        }
        // Private model endpoints — credentials required
        "openai" => {
            let creds = secret_store::get_provider_credentials("openai")?;
            let url = base_url.unwrap_or(creds.base_url);
            let client = OpenAiClient::new(url, creds.api_key);
            client.list_models_raw().await
        }
        "anthropic" => {
            let creds = secret_store::get_provider_credentials("anthropic")?;
            let url = base_url.unwrap_or(creds.base_url);
            let client = AnthropicClient::new(url, creds.api_key);
            client.list_models().await
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

// ---------------------------------------------------------------------------
// Multi-provider chat completion
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn provider_chat_completion(
    provider: String,
    messages: Vec<ChatMessage>,
    model: String,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    response_format: Option<Value>,
) -> Result<String, String> {
    let msg_count = messages.len();
    let total_chars: usize = messages.iter().map(|m| m.content.len()).sum();
    let has_rf = response_format.is_some();
    eprintln!(
        "[ai] chat_completion: provider={} model={} messages={} chars={} response_format={}",
        provider, model, msg_count, total_chars, has_rf
    );

    let creds = secret_store::get_provider_credentials(&provider)?;

    let start = std::time::Instant::now();
    let result = match provider.as_str() {
        "openai" | "openrouter" => {
            let client = OpenAiClient::new(creds.base_url, creds.api_key);
            let request = ChatCompletionRequest {
                model,
                messages,
                stream: Some(false),
                temperature,
                max_tokens,
                response_format,
            };
            let response = client.chat_completion(request).await?;
            serde_json::to_string(&response).map_err(|e| e.to_string())
        }
        "kilo" => {
            let client = OpenAiClient::new(creds.base_url, creds.api_key)
                .with_path_prefix("");
            let request = ChatCompletionRequest {
                model,
                messages,
                stream: Some(false),
                temperature,
                max_tokens,
                response_format,
            };
            client.chat_completion_raw(request).await
        }
        "anthropic" => {
            let client = AnthropicClient::new(creds.base_url, creds.api_key);
            let request = AnthropicClient::prepare_request(
                &messages, &model, temperature, max_tokens,
            );
            let response = client.chat_completion(request).await?;
            // Return OpenAI-compatible JSON so the frontend uses the same parsing path
            AnthropicClient::to_openai_compat_json(&response)
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    };

    let elapsed = start.elapsed();
    match &result {
        Ok(raw) => {
            eprintln!("[ai] chat_completion OK ({:.1}s, {} bytes)", elapsed.as_secs_f64(), raw.len());
            // Extract and print the content field from the response for debugging
            if let Ok(val) = serde_json::from_str::<Value>(raw) {
                if let Some(content) = val.pointer("/choices/0/message/content").and_then(|c| c.as_str()) {
                    eprintln!("[ai] content:\n{}", content);
                }
            }
        }
        Err(e) => eprintln!("[ai] chat_completion ERR ({:.1}s): {}", elapsed.as_secs_f64(), e),
    }
    result
}

#[tauri::command]
pub fn has_chatgpt_session() -> bool {
    secret_store::has_chatgpt_tokens()
}

#[tauri::command]
pub fn get_auth_type() -> String {
    secret_store::get_auth_type().unwrap_or_else(|_| "api_key".to_string())
}

#[tauri::command]
pub fn set_auth_type(auth_type: String) -> Result<(), String> {
    if auth_type != "api_key" && auth_type != "chatgpt_login" {
        return Err("Invalid auth type".to_string());
    }
    secret_store::save_auth_type(&auth_type)
}

#[tauri::command]
pub async fn start_chatgpt_login(
    app: tauri::AppHandle,
    pending: tauri::State<'_, Arc<Mutex<Option<super::chatgpt_auth_server::PendingOAuth>>>>,
) -> Result<(), String> {
    let port = chatgpt_auth::find_available_port()?;
    let state = uuid::Uuid::new_v4().to_string();
    let pkce = chatgpt_auth::generate_pkce_challenge();

    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);
    let auth_url = format!(
        "{}/authorize?response_type=code&client_id={}&scope={}&audience={}&redirect_uri={}&state={}&code_challenge={}&code_challenge_method=S256",
        chatgpt_auth::OPENAI_AUTH_BASE_URL,
        chatgpt_auth::OPENAI_AUTH_CLIENT_ID,
        urlencoding::encode(chatgpt_auth::OPENAI_AUTH_SCOPE),
        urlencoding::encode(chatgpt_auth::OPENAI_AUTH_AUDIENCE),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&state),
        urlencoding::encode(&pkce.challenge),
    );

    let pending_oauth = super::chatgpt_auth_server::PendingOAuth {
        state: state.clone(),
        code_verifier: pkce.verifier.clone(),
        port,
    };

    {
        let mut guard = pending.lock().await;
        *guard = Some(pending_oauth);
    }

    let server_pending = pending.inner().clone();
    super::chatgpt_auth_server::start_callback_server(server_pending, app.clone())?;

    open_url(&app, &auth_url)?;

    Ok(())
}

fn open_url(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell().open(url, None).map_err(|e| format!("Failed to open browser: {}", e))
}

#[tauri::command]
pub fn clear_chatgpt_session() -> Result<(), String> {
    secret_store::clear_chatgpt_tokens()?;
    let _ = secret_store::save_auth_type("api_key");
    Ok(())
}

#[tauri::command]
pub async fn validate_chatgpt_session() -> Result<bool, String> {
    let tokens = secret_store::get_chatgpt_tokens()?;

    if let Some(expires_at) = tokens.expires_at {
        let now = chrono_now_secs();
        if now >= expires_at {
            if let Some(refresh_token) = tokens.refresh_token {
                let new_tokens =
                    chatgpt_auth::refresh_access_token(&refresh_token).await?;
                let chatgpt_client = ChatGPTWebClient::new(new_tokens.access_token.clone());
                let valid = chatgpt_client.validate_token().await?;

                if valid {
                    let expires_at = new_tokens
                        .expires_in
                        .map(|d| chrono_now_secs() + d as i64);
                    secret_store::save_chatgpt_tokens(&secret_store::ChatGPTTokens {
                        access_token: new_tokens.access_token,
                        refresh_token: new_tokens.refresh_token.or(Some(refresh_token)),
                        expires_at,
                    })?;
                    return Ok(true);
                }
            }
            return Ok(false);
        }
    }

    let client = ChatGPTWebClient::new(tokens.access_token);
    client.validate_token().await
}

fn chrono_now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[tauri::command]
pub async fn chat_completion(
    messages: Vec<ChatMessage>,
    model: String,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    response_format: Option<Value>,
) -> Result<String, String> {
    let auth_type = secret_store::get_auth_type().unwrap_or_else(|_| "api_key".to_string());

    if auth_type == "chatgpt_login" {
        return chatgpt_chat_completion(messages, model).await;
    }

    let creds = secret_store::get_ai_credentials()?;
    let client = OpenAiClient::new(creds.base_url, creds.api_key);

    let request = ChatCompletionRequest {
        model,
        messages,
        stream: Some(false),
        temperature,
        max_tokens,
        response_format,
    };

    let response = client.chat_completion(request).await?;
    Ok(serde_json::to_string(&response).map_err(|e| e.to_string())?)
}

async fn chatgpt_chat_completion(
    messages: Vec<ChatMessage>,
    model: String,
) -> Result<String, String> {
    let tokens = secret_store::get_chatgpt_tokens()?;

    let access_token = if let Some(expires_at) = tokens.expires_at {
        let now = chrono_now_secs();
        if now >= expires_at {
            if let Some(refresh_token) = tokens.refresh_token {
                let new_tokens = chatgpt_auth::refresh_access_token(&refresh_token).await?;
                let expires_at = new_tokens.expires_in.map(|d| chrono_now_secs() + d as i64);
                let access_token = new_tokens.access_token.clone();
                secret_store::save_chatgpt_tokens(&secret_store::ChatGPTTokens {
                    access_token: new_tokens.access_token,
                    refresh_token: new_tokens.refresh_token.or(Some(refresh_token)),
                    expires_at,
                })?;
                access_token
            } else {
                return Err("ChatGPT \u{4F1A}\u{8BDD}\u{5DF2}\u{8FC7}\u{671F}\u{FF0C}\u{8BF7}\u{91CD}\u{65B0}\u{767B}\u{5F55}".to_string());
            }
        } else {
            tokens.access_token
        }
    } else {
        tokens.access_token
    };

    let client = ChatGPTWebClient::new(access_token);
    client.conversation(messages, model).await
}

#[tauri::command]
pub async fn chat_completion_stream(
    messages: Vec<ChatMessage>,
    model: String,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    response_format: Option<Value>,
) -> Result<String, String> {
    chat_completion(messages, model, temperature, max_tokens, response_format).await
}