use crate::ai::chatgpt_auth;
use crate::ai::secret_store;
use std::net::TcpListener;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;

#[derive(Debug)]
pub struct PendingOAuth {
    pub state: String,
    pub code_verifier: String,
    pub port: u16,
}

pub fn start_callback_server(
    listener: TcpListener,
    pending: Arc<Mutex<Option<PendingOAuth>>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    {
        let guard = pending.blocking_lock();
        guard.as_ref().ok_or("No pending OAuth")?;
    }

    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to configure callback listener: {}", e))?;

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        rt.block_on(async move {
            let listener = match tokio::net::TcpListener::from_std(listener) {
                Ok(l) => l,
                Err(e) => {
                    let _ = app.emit("chatgpt-login-error", format!("Failed to start callback server: {}", e));
                    return;
                }
            };

            let timeout = tokio::time::timeout(std::time::Duration::from_secs(300), async {
                loop {
                    let (stream, _) = match listener.accept().await {
                        Ok(s) => s,
                        Err(_) => continue,
                    };

                    let pending_clone = pending.clone();
                    let app_clone = app.clone();
                    tokio::spawn(handle_connection(stream, pending_clone, app_clone));
                }
            }).await;

            if timeout.is_err() {
                let mut guard = pending.lock().await;
                *guard = None;
            }
        });
    });

    Ok(())
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    pending: Arc<Mutex<Option<PendingOAuth>>>,
    app: tauri::AppHandle,
) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut buffer = vec![0u8; 8192];
    let (mut reader, mut writer) = stream.into_split();

    let n = match reader.read(&mut buffer).await {
        Ok(n) => n,
        Err(_) => return,
    };

    let request = String::from_utf8_lossy(&buffer[..n]);
    let request_line = request.lines().next().unwrap_or("");

    let query_string = if let Some(path) = request_line.split(' ').nth(1) {
        if let Some(query) = path.split('?').nth(1) {
            query.to_string()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let params: std::collections::HashMap<String, String> = query_string
        .split('&')
        .filter_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let key = parts.next()?.to_string();
            let value = urlencoding::decode(parts.next()?).ok()?.to_string();
            Some((key, value))
        })
        .collect();

    let code = params.get("code").cloned();
    let state = params.get("state").cloned();

    let response_body = if code.is_some() {
        "<html><body><h2>\u{767B}\u{5F55}\u{6210}\u{529F}\u{FF01}</h2><p>\u{6B63}\u{5728}\u{8FD4}\u{56DE} MixBoard\u{FF0C}\u{4F60}\u{53EF}\u{4EE5}\u{5173}\u{95ED}\u{6B64}\u{9875}\u{9762}\u{3002}</p><script>window.close()</script></body></html>"
    } else {
        "<html><body><h2>\u{767B}\u{5F55}\u{5931}\u{8D25}</h2><p>\u{672A}\u{83B7}\u{53D6}\u{5230}\u{6388}\u{6743}\u{7801}\u{FF0C}\u{8BF7}\u{91CD}\u{8BD5}\u{3002}</p></body></html>"
    };

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        response_body.len(),
        response_body
    );

    let _ = writer.write_all(response.as_bytes()).await;
    let _ = writer.flush().await;

    if let Some(code) = code {
        let oauth_result = {
            let guard = pending.lock().await;
            if let Some(ref oauth) = *guard {
                if oauth.state != state.unwrap_or_default() {
                    Err("State mismatch - possible CSRF attack".to_string())
                } else {
                    Ok((code.clone(), oauth.code_verifier.clone(), oauth.port))
                }
            } else {
                Err("No pending OAuth flow".to_string())
            }
        };

        match oauth_result {
            Ok((code, verifier, port)) => {
                let result = chatgpt_auth::exchange_code_for_tokens(&code, &verifier, port).await;

                match result {
                    Ok(tokens) => {
                        let expires_at = tokens.expires_in.map(|d| {
                            std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs() as i64
                                + d as i64
                        });

                        let store_result = secret_store::save_chatgpt_tokens(
                            &secret_store::ChatGPTTokens {
                                access_token: tokens.access_token,
                                refresh_token: tokens.refresh_token,
                                expires_at,
                            },
                        );

                        if let Err(e) = store_result {
                            let _ = app.emit("chatgpt-login-error", format!("Failed to save tokens: {}", e));
                            return;
                        }

                        let _ = secret_store::save_auth_type("chatgpt_login");
                        let _ = app.emit("chatgpt-login-success", true);
                    }
                    Err(e) => {
                        let _ = app.emit("chatgpt-login-error", format!("Token exchange failed: {}", e));
                    }
                }

                let mut guard = pending.lock().await;
                *guard = None;
            }
            Err(e) => {
                let _ = app.emit("chatgpt-login-error", e);
                let mut guard = pending.lock().await;
                *guard = None;
            }
        }
    } else {
        let error_desc = params.get("error_description").cloned().unwrap_or_default();
        let _ = app.emit("chatgpt-login-error", format!("Authorization denied: {}", error_desc));
        let mut guard = pending.lock().await;
        *guard = None;
    }
}
