use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::Client;
use sha2::{Digest, Sha256};
use std::net::TcpListener;

pub const OPENAI_AUTH_CLIENT_ID: &str = "DRivsnm2Mu42T3KOpqdtwB3NYviHYzwD";
pub const OPENAI_AUTH_BASE_URL: &str = "https://auth0.openai.com";
pub const OPENAI_AUTH_AUDIENCE: &str = "https://api.openai.com/v1";
pub const OPENAI_AUTH_SCOPE: &str = "openid email profile offline_access model.request model.read";

#[derive(Debug)]
pub struct PkceChallenge {
    pub verifier: String,
    pub challenge: String,
}

pub fn generate_pkce_challenge() -> PkceChallenge {
    let verifier = uuid::Uuid::new_v4().to_string() + &uuid::Uuid::new_v4().to_string();
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    let challenge = URL_SAFE_NO_PAD.encode(hash);

    PkceChallenge {
        verifier,
        challenge,
    }
}

pub fn bind_callback_listener() -> Result<TcpListener, String> {
    TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Failed to bind callback listener: {}", e))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    pub token_type: String,
    pub expires_in: Option<u64>,
}

pub async fn exchange_code_for_tokens(
    code: &str,
    code_verifier: &str,
    redirect_port: u16,
) -> Result<TokenResponse, String> {
    let client = Client::new();
    let redirect_uri = format!("http://127.0.0.1:{}/callback", redirect_port);

    let response = client
        .post(format!("{}/oauth/token", OPENAI_AUTH_BASE_URL))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "grant_type": "authorization_code",
            "client_id": OPENAI_AUTH_CLIENT_ID,
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        }))
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed ({}): {}", status, text));
    }

    response
        .json::<TokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))
}

pub async fn refresh_access_token(refresh_token: &str) -> Result<TokenResponse, String> {
    let client = Client::new();

    let response = client
        .post(format!("{}/oauth/token", OPENAI_AUTH_BASE_URL))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "client_id": OPENAI_AUTH_CLIENT_ID,
            "refresh_token": refresh_token,
        }))
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Token refresh failed ({}): {}", status, text));
    }

    response
        .json::<TokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))
}
