use keyring::Entry;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Per-provider service names in the system keychain
// ---------------------------------------------------------------------------

const SERVICE_OPENAI: &str = "mixboard-ai";
const SERVICE_ANTHROPIC: &str = "mixboard-anthropic";
const SERVICE_OPENROUTER: &str = "mixboard-openrouter";
const SERVICE_KILO: &str = "mixboard-kilo";

fn service_for_provider(provider: &str) -> Result<&'static str, String> {
    match provider {
        "openai" => Ok(SERVICE_OPENAI),
        "anthropic" => Ok(SERVICE_ANTHROPIC),
        "openrouter" => Ok(SERVICE_OPENROUTER),
        "kilo" => Ok(SERVICE_KILO),
        other => Err(format!("Unknown AI provider: {}", other)),
    }
}

// ---------------------------------------------------------------------------
// Generic provider credentials (api_key + base_url)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiCredentials {
    pub api_key: String,
    pub base_url: String,
}

pub fn save_provider_credentials(provider: &str, api_key: &str, base_url: &str) -> Result<(), String> {
    let service = service_for_provider(provider)?;

    let entry = Entry::new(service, "api_key").map_err(|e| e.to_string())?;
    entry.set_password(api_key).map_err(|e| e.to_string())?;

    let entry = Entry::new(service, "base_url").map_err(|e| e.to_string())?;
    entry.set_password(base_url).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn get_provider_credentials(provider: &str) -> Result<AiCredentials, String> {
    let service = service_for_provider(provider)?;

    let entry = Entry::new(service, "api_key").map_err(|e| e.to_string())?;
    let api_key = entry.get_password().map_err(|e| e.to_string())?;

    let entry = Entry::new(service, "base_url").map_err(|e| e.to_string())?;
    let base_url = entry.get_password().map_err(|e| e.to_string())?;

    Ok(AiCredentials { api_key, base_url })
}

pub fn has_provider_credentials(provider: &str) -> bool {
    let service = match service_for_provider(provider) {
        Ok(s) => s,
        Err(_) => return false,
    };

    let entry = match Entry::new(service, "api_key") {
        Ok(entry) => entry,
        Err(_) => return false,
    };

    match entry.get_password() {
        Ok(api_key) => !api_key.trim().is_empty(),
        Err(_) => false,
    }
}

pub fn clear_provider_credentials(provider: &str) -> Result<(), String> {
    let service = service_for_provider(provider)?;

    for key in ["api_key", "base_url"] {
        let entry = Entry::new(service, key);
        if let Ok(e) = entry {
            let _ = e.delete_credential();
        }
    }

    Ok(())
}

pub fn get_provider_base_url(provider: &str) -> Result<String, String> {
    let creds = get_provider_credentials(provider)?;
    Ok(creds.base_url)
}

// ---------------------------------------------------------------------------
// Backwards-compatible aliases for the original "openai" only API
// ---------------------------------------------------------------------------

pub fn save_ai_credentials(api_key: &str, base_url: &str) -> Result<(), String> {
    save_provider_credentials("openai", api_key, base_url)
}

pub fn get_ai_credentials() -> Result<AiCredentials, String> {
    get_provider_credentials("openai")
}

pub fn has_ai_credentials() -> bool {
    has_provider_credentials("openai")
}

pub fn clear_ai_credentials() -> Result<(), String> {
    clear_provider_credentials("openai")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatGPTTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

const CHATGPT_SERVICE_OPENAI: &str = "mixboard-chatgpt";

pub fn save_chatgpt_tokens(tokens: &ChatGPTTokens) -> Result<(), String> {
    let entry = Entry::new(CHATGPT_SERVICE_OPENAI, "access_token").map_err(|e| e.to_string())?;
    entry
        .set_password(&tokens.access_token)
        .map_err(|e| e.to_string())?;

    if let Some(ref refresh_token) = tokens.refresh_token {
        let entry = Entry::new(CHATGPT_SERVICE_OPENAI, "refresh_token").map_err(|e| e.to_string())?;
        entry
            .set_password(refresh_token)
            .map_err(|e| e.to_string())?;
    }

    if let Some(expires_at) = tokens.expires_at {
        let entry = Entry::new(CHATGPT_SERVICE_OPENAI, "expires_at").map_err(|e| e.to_string())?;
        entry
            .set_password(&expires_at.to_string())
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn get_chatgpt_tokens() -> Result<ChatGPTTokens, String> {
    let entry = Entry::new(CHATGPT_SERVICE_OPENAI, "access_token").map_err(|e| e.to_string())?;
    let access_token = entry.get_password().map_err(|e| e.to_string())?;

    let refresh_token = match Entry::new(CHATGPT_SERVICE_OPENAI, "refresh_token") {
        Ok(entry) => entry.get_password().ok(),
        Err(_) => None,
    };

    let expires_at = match Entry::new(CHATGPT_SERVICE_OPENAI, "expires_at") {
        Ok(entry) => entry
            .get_password()
            .ok()
            .and_then(|s| s.parse::<i64>().ok()),
        Err(_) => None,
    };

    Ok(ChatGPTTokens {
        access_token,
        refresh_token,
        expires_at,
    })
}

pub fn has_chatgpt_tokens() -> bool {
    let entry = match Entry::new(CHATGPT_SERVICE_OPENAI, "access_token") {
        Ok(entry) => entry,
        Err(_) => return false,
    };

    match entry.get_password() {
        Ok(token) => !token.trim().is_empty(),
        Err(_) => false,
    }
}

pub fn clear_chatgpt_tokens() -> Result<(), String> {
    let keys = ["access_token", "refresh_token", "expires_at"];
    for key in keys {
        let entry = Entry::new(CHATGPT_SERVICE_OPENAI, key);
        if let Ok(e) = entry {
            let _ = e.delete_credential();
        }
    }

    Ok(())
}

pub fn save_auth_type(auth_type: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_OPENAI, "auth_type").map_err(|e| e.to_string())?;
    entry.set_password(auth_type).map_err(|e| e.to_string())
}

pub fn get_auth_type() -> Result<String, String> {
    let entry = Entry::new(SERVICE_OPENAI, "auth_type").map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

pub fn has_auth_type() -> bool {
    match Entry::new(SERVICE_OPENAI, "auth_type") {
        Ok(entry) => entry.get_password().is_ok(),
        Err(_) => false,
    }
}
