//! OS/network adapters for the shared desktop sign-in policy. Secrets never cross IPC.
use audit_core::desktop_auth::{self, Profile};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::{Duration, Instant},
};

const ORIGIN: &str = match option_env!("ORVEN_DESKTOP_AUTH_ORIGIN") {
    Some(origin) => origin,
    None => "https://orven-handoff.surtrcode.workers.dev",
};
const KEYCHAIN_SERVICE: &str = "dev.orven.desktop.account.v1";

#[derive(Clone, Serialize)]
pub struct AccountView {
    pub status: &'static str,
    pub profile: Option<Profile>,
    pub avatar_data_url: Option<String>,
}
impl AccountView {
    fn signed_out() -> Self {
        Self {
            status: "signed_out",
            profile: None,
            avatar_data_url: None,
        }
    }
    fn waiting() -> Self {
        Self {
            status: "waiting",
            profile: None,
            avatar_data_url: None,
        }
    }
}
struct Pending {
    listener: TcpListener,
    port: u16,
    state: String,
    verifier: String,
    started: Instant,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Exchange {
    desktop_credential: String,
    expires_at: u64,
    profile: Profile,
}
trait CredentialVault: Send {
    fn load(&self) -> Result<Option<String>, String>;
    fn save(&self, credential: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}
struct Keychain;
impl CredentialVault for Keychain {
    fn load(&self) -> Result<Option<String>, String> {
        read_credential()
    }
    fn save(&self, credential: &str) -> Result<(), String> {
        write_credential(credential)
    }
    fn delete(&self) -> Result<(), String> {
        delete_credential()
    }
}
trait AccountBackend: Send {
    fn check_available(&self) -> Result<(), String>;
    fn profile(&self, credential: &str) -> Result<Option<Profile>, String>;
    fn exchange(&self, code: &str, verifier: &str, redirect: &str) -> Result<Exchange, String>;
    fn revoke(&self, credential: &str) -> Result<(), String>;
    fn avatar(&self, _: &str) -> Option<String> {
        None
    }
}
struct HttpsBackend;
impl AccountBackend for HttpsBackend {
    fn check_available(&self) -> Result<(), String> {
        // No credential is sent. A placeholder HTTP 200 must never start a login.
        let response = client()?
            .get(format!("{ORIGIN}/auth/desktop/profile"))
            .send()
            .map_err(|_| "Authentication service unavailable; retry later")?;
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let mut body = Vec::new();
        response
            .take(1025)
            .read_to_end(&mut body)
            .map_err(|_| "Authentication service response unavailable")?;
        if !valid_auth_probe(status, &content_type, &body) {
            return Err("Authentication API unavailable; verify the Worker deployment".into());
        }
        Ok(())
    }
    fn profile(&self, credential: &str) -> Result<Option<Profile>, String> {
        let response = client()?
            .get(format!("{ORIGIN}/auth/desktop/profile"))
            .bearer_auth(credential)
            .send()
            .map_err(|_| "Cannot verify GitHub session; credential retained for retry")?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err("Cannot verify GitHub session; retry later".into());
        }
        decode(response).map(Some)
    }
    fn exchange(&self, code: &str, verifier: &str, redirect: &str) -> Result<Exchange, String> {
        let response = client()?
            .post(format!("{ORIGIN}/auth/desktop/exchange"))
            .json(&serde_json::json!({
                "code": code, "code_verifier": verifier, "redirect_uri": redirect,
            }))
            .send()
            .map_err(|_| "Desktop sign-in exchange failed; restart sign-in")?;
        if !response.status().is_success() {
            return Err("Desktop sign-in authorization was rejected".into());
        }
        decode(response)
    }
    fn revoke(&self, credential: &str) -> Result<(), String> {
        revoke(credential)
    }
    fn avatar(&self, url: &str) -> Option<String> {
        avatar(url)
    }
}
pub struct Account {
    pending: Option<Pending>,
    vault: Box<dyn CredentialVault>,
    backend: Box<dyn AccountBackend>,
}
impl Account {
    pub fn new() -> Self {
        Self {
            pending: None,
            vault: Box::new(Keychain),
            backend: Box::new(HttpsBackend),
        }
    }
    pub fn begin(&mut self) -> Result<String, String> {
        if !desktop_auth::valid_origin(ORIGIN) {
            return Err("Authentication origin is not configured".into());
        }
        // Do not let account switching silently strand an existing credential.
        if self.vault.load()?.is_some() {
            return Err("Sign out before changing GitHub accounts".into());
        }
        self.pending = None;
        self.backend.check_available()?;
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "Cannot open local authentication callback")?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "Cannot configure local callback")?;
        let port = listener
            .local_addr()
            .map_err(|_| "Cannot read callback port")?
            .port();
        let state = desktop_auth::random_secret();
        let verifier = desktop_auth::random_secret();
        let url =
            desktop_auth::sign_in_url(ORIGIN, port, &state, &verifier).map_err(str::to_owned)?;
        self.pending = Some(Pending {
            listener,
            port,
            state,
            verifier,
            started: Instant::now(),
        });
        Ok(url.to_string())
    }
    pub fn cancel(&mut self) {
        self.pending = None;
    }
    pub fn restore(&mut self) -> Result<AccountView, String> {
        if self.pending.is_some() {
            return Ok(AccountView::waiting());
        }
        let Some(credential) = self.vault.load()? else {
            return Ok(AccountView::signed_out());
        };
        let Some(profile) = self.backend.profile(&credential)? else {
            self.vault.delete()?;
            return Ok(AccountView {
                status: "expired",
                profile: None,
                avatar_data_url: None,
            });
        };
        self.verified_view(profile)
    }

    pub fn poll(&mut self) -> Result<AccountView, String> {
        let Some(pending) = self.pending.as_ref() else {
            return Ok(AccountView::signed_out());
        };
        if pending.started.elapsed() >= Duration::from_secs(desktop_auth::LOGIN_SECONDS) {
            self.pending = None;
            return Err("GitHub sign-in expired; try again".into());
        }
        let (mut stream, peer) = match pending.listener.accept() {
            Ok(connection) => connection,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                return Ok(AccountView::waiting());
            }
            Err(_) => {
                self.pending = None;
                return Err("Local sign-in callback failed".into());
            }
        };
        if !peer.ip().is_loopback() {
            return Ok(AccountView::waiting());
        }
        // macOS accepted sockets inherit O_NONBLOCK from the listener.
        stream
            .set_nonblocking(false)
            .map_err(|_| "Callback unavailable")?;
        stream
            .set_read_timeout(Some(Duration::from_millis(150)))
            .map_err(|_| "Callback unavailable")?;
        stream
            .set_write_timeout(Some(Duration::from_millis(150)))
            .map_err(|_| "Callback unavailable")?;
        let mut buffer = Vec::new();
        let mut chunk = [0; 512];
        let read_started = Instant::now();
        while buffer.len() <= 4096
            && read_started.elapsed() < Duration::from_millis(150)
            && !buffer.ends_with(b"\r\n\r\n")
        {
            match stream.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => buffer.extend_from_slice(&chunk[..n]),
            }
        }
        let code = std::str::from_utf8(&buffer)
            .ok()
            .and_then(|headers| desktop_auth::callback_code(headers, pending.port, &pending.state));
        let status = if code.is_some() {
            "200 OK"
        } else {
            "400 Bad Request"
        };
        let body = if code.is_some() {
            "Return to Orven to finish signing in. You may close this tab."
        } else {
            "Invalid sign-in callback."
        };
        let _ = write!(
            stream,
            "HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let Some(code) = code else {
            return Ok(AccountView::waiting());
        };
        let pending = self.pending.take().ok_or("Sign-in no longer active")?;
        // Drop the loopback listener before exchanging the one-use code.
        drop(pending.listener);
        let result = self.backend.exchange(
            &code,
            &pending.verifier,
            &format!("http://127.0.0.1:{}/orven-auth/callback", pending.port),
        )?;
        if !desktop_auth::opaque_code(&result.desktop_credential)
            || !result.profile.validate()
            || result.expires_at <= unix_millis()
        {
            return Err("Backend returned an invalid desktop session".into());
        }
        if let Err(error) = self.vault.save(&result.desktop_credential) {
            let _ = self.backend.revoke(&result.desktop_credential);
            return Err(error);
        }
        self.verified_view(result.profile)
    }
    pub fn logout(&mut self) -> Result<AccountView, String> {
        self.pending = None;
        if let Some(credential) = self.vault.load()? {
            // A network failure keeps the credential so revocation can be retried.
            self.backend.revoke(&credential)?;
            self.vault.delete()?;
        }
        Ok(AccountView::signed_out())
    }
    fn verified_view(&self, profile: Profile) -> Result<AccountView, String> {
        if !profile.validate() {
            return Err("Backend profile invalid".into());
        }
        let avatar_data_url = self.backend.avatar(&profile.avatar_url);
        Ok(AccountView {
            status: "authenticated",
            profile: Some(profile),
            avatar_data_url,
        })
    }
}
fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn valid_auth_probe(status: u16, content_type: &str, body: &[u8]) -> bool {
    status == 401
        && content_type
            .split(';')
            .next()
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
        && body.len() <= 1024
        && serde_json::from_slice::<serde_json::Value>(body)
            .is_ok_and(|value| value == serde_json::json!({ "error": "Unauthorized" }))
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .no_proxy()
        .user_agent("Orven-Desktop")
        .build()
        .map_err(|_| "HTTPS client unavailable".into())
}
fn decode<T: serde::de::DeserializeOwned>(
    response: reqwest::blocking::Response,
) -> Result<T, String> {
    let mut bytes = Vec::new();
    response
        .take(16_385)
        .read_to_end(&mut bytes)
        .map_err(|_| "Backend response unavailable")?;
    if bytes.len() > 16_384 {
        return Err("Backend response exceeded limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Backend response invalid".into())
}
fn revoke(credential: &str) -> Result<(), String> {
    let response = client()?
        .post(format!("{ORIGIN}/auth/desktop/revoke"))
        .bearer_auth(credential)
        .send()
        .map_err(|_| "Cannot revoke desktop session; credential retained, retry sign out")?;
    if response.status().is_success() || response.status() == reqwest::StatusCode::UNAUTHORIZED {
        Ok(())
    } else {
        Err("Cannot revoke desktop session; retry sign out".into())
    }
}
fn avatar(url: &str) -> Option<String> {
    use std::fmt::Write;
    // Only called after Profile::validate fixed the host and numeric account path.
    let response = client().ok()?.get(url).send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)?
        .to_str()
        .ok()?
        .split(';')
        .next()?
        .to_owned();
    if !["image/png", "image/jpeg"].contains(&mime.as_str()) {
        return None;
    }
    let mut bytes = Vec::new();
    response.take(262_145).read_to_end(&mut bytes).ok()?;
    if bytes.len() > 262_144 {
        return None;
    }
    // Percent-encoded data URI avoids exposing a new network capability to the WebView.
    let mut data = format!("data:{mime},");
    for byte in bytes {
        write!(&mut data, "%{byte:02X}").ok()?;
    }
    Some(data)
}
#[cfg(target_os = "macos")]
fn read_credential() -> Result<Option<String>, String> {
    match security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, ORIGIN) {
        Ok(value) => String::from_utf8(value)
            .map(Some)
            .map_err(|_| "Stored desktop credential invalid".into()),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(_) => Err("macOS Keychain unavailable or access denied".into()),
    }
}
#[cfg(target_os = "macos")]
fn write_credential(value: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(KEYCHAIN_SERVICE, ORIGIN, value.as_bytes())
        .map_err(|_| "Cannot save desktop credential in macOS Keychain".into())
}
#[cfg(target_os = "macos")]
fn delete_credential() -> Result<(), String> {
    match security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, ORIGIN) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == -25300 => Ok(()),
        Err(_) => Err("Cannot remove desktop credential from macOS Keychain".into()),
    }
}
#[cfg(not(target_os = "macos"))]
fn read_credential() -> Result<Option<String>, String> {
    Err("Secure account storage is supported only on macOS".into())
}
#[cfg(not(target_os = "macos"))]
fn write_credential(_: &str) -> Result<(), String> {
    Err("Secure account storage unavailable".into())
}
#[cfg(not(target_os = "macos"))]
fn delete_credential() -> Result<(), String> {
    Err("Secure account storage unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    #[derive(Default)]
    struct Fixture {
        credential: Option<String>,
        revoked: bool,
        unavailable: bool,
        save_denied: bool,
    }
    struct Vault(Arc<Mutex<Fixture>>);
    impl CredentialVault for Vault {
        fn load(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().credential.clone())
        }
        fn save(&self, credential: &str) -> Result<(), String> {
            let mut state = self.0.lock().unwrap();
            if state.save_denied {
                return Err("Keychain denied".into());
            }
            state.credential = Some(credential.to_owned());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            self.0.lock().unwrap().credential = None;
            Ok(())
        }
    }
    struct Backend(Arc<Mutex<Fixture>>);
    fn fixture_profile() -> Profile {
        Profile {
            user_id: "11111111-1111-4111-8111-111111111111".into(),
            github_account_id: "42".into(),
            username: "fixture".into(),
            avatar_url: "https://avatars.githubusercontent.com/u/42?v=4".into(),
        }
    }
    impl AccountBackend for Backend {
        fn check_available(&self) -> Result<(), String> {
            if self.0.lock().unwrap().unavailable {
                Err("Unavailable".into())
            } else {
                Ok(())
            }
        }
        fn profile(&self, _: &str) -> Result<Option<Profile>, String> {
            let state = self.0.lock().unwrap();
            if state.unavailable {
                return Err("Unavailable".into());
            }
            Ok(if state.revoked {
                None
            } else {
                Some(fixture_profile())
            })
        }
        fn exchange(&self, _: &str, _: &str, _: &str) -> Result<Exchange, String> {
            Ok(Exchange {
                desktop_credential: "a".repeat(43),
                expires_at: unix_millis() + 60_000,
                profile: fixture_profile(),
            })
        }
        fn revoke(&self, _: &str) -> Result<(), String> {
            let mut state = self.0.lock().unwrap();
            if state.unavailable {
                return Err("Unavailable".into());
            }
            state.revoked = true;
            Ok(())
        }
    }
    fn account(fixture: &Arc<Mutex<Fixture>>) -> Account {
        Account {
            pending: None,
            vault: Box::new(Vault(fixture.clone())),
            backend: Box::new(Backend(fixture.clone())),
        }
    }
    #[test]
    fn placeholder_or_unavailable_backend_cannot_start_login() {
        assert!(valid_auth_probe(
            401,
            "application/json; charset=utf-8",
            br#"{"error":"Unauthorized"}"#
        ));
        assert!(!valid_auth_probe(200, "text/plain", b"Hello World!"));
        assert!(!valid_auth_probe(
            200,
            "application/json",
            br#"{"error":"Unauthorized"}"#
        ));
        assert!(!valid_auth_probe(
            401,
            "text/html",
            br#"{"error":"Unauthorized"}"#
        ));
        assert!(!valid_auth_probe(401, "application/json", b"invalid"));
        assert!(!valid_auth_probe(
            503,
            "application/json",
            br#"{"error":"Unauthorized"}"#
        ));
        let fixture = Arc::new(Mutex::new(Fixture {
            unavailable: true,
            ..Default::default()
        }));
        let mut app = account(&fixture);
        assert!(app.begin().is_err());
        assert!(app.pending.is_none());
        assert_eq!(app.restore().unwrap().status, "signed_out");
        assert!(fixture.lock().unwrap().credential.is_none());
    }
    #[test]
    fn restart_restores_from_vault_and_revocation_is_verified() {
        let fixture = Arc::new(Mutex::new(Fixture {
            credential: Some("a".repeat(43)),
            ..Default::default()
        }));
        let mut first = account(&fixture);
        assert_eq!(first.restore().unwrap().status, "authenticated");
        assert!(first.begin().is_err());
        drop(first);
        let mut restarted = account(&fixture);
        let view = restarted.restore().unwrap();
        assert_eq!(view.profile.as_ref().unwrap().username, "fixture");
        assert!(
            !serde_json::to_string(&view)
                .unwrap()
                .contains(&"a".repeat(43))
        );
        assert_eq!(restarted.logout().unwrap().status, "signed_out");
        assert!(fixture.lock().unwrap().revoked);
        assert!(fixture.lock().unwrap().credential.is_none());
    }
    #[test]
    fn outage_preserves_credential_and_server_rejection_removes_it() {
        let fixture = Arc::new(Mutex::new(Fixture {
            credential: Some("a".repeat(43)),
            unavailable: true,
            ..Default::default()
        }));
        let mut app = account(&fixture);
        assert!(app.restore().is_err());
        assert!(app.logout().is_err());
        assert!(fixture.lock().unwrap().credential.is_some());
        {
            let mut state = fixture.lock().unwrap();
            state.unavailable = false;
            state.revoked = true;
        }
        assert_eq!(app.restore().unwrap().status, "expired");
        assert!(fixture.lock().unwrap().credential.is_none());
    }
    #[test]
    fn actual_loopback_binds_state_and_never_serializes_credentials() {
        let fixture = Arc::new(Mutex::new(Fixture::default()));
        let mut app = account(&fixture);
        let url = tauri::Url::parse(&app.begin().unwrap()).unwrap();
        assert_eq!(url.host_str(), Some("orven-handoff.surtrcode.workers.dev"));
        let pending = app.pending.as_ref().unwrap();
        assert!(pending.listener.local_addr().unwrap().ip().is_loopback());
        let port = pending.port;
        let state = pending.state.clone();
        let code = "b".repeat(43);
        let mut wrong =
            std::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)).unwrap();
        write!(wrong, "GET /orven-auth/callback?code={code}&state=wrong HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").unwrap();
        assert_eq!(app.poll().unwrap().status, "waiting");
        let mut good = std::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)).unwrap();
        write!(good, "GET /orven-auth/callback?code={code}&state={state} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").unwrap();
        let view = app.poll().unwrap();
        assert_eq!(view.status, "authenticated");
        assert!(fixture.lock().unwrap().credential.is_some());
        assert!(app.pending.is_none());
        assert!(
            !serde_json::to_string(&view)
                .unwrap()
                .contains(&"a".repeat(43))
        );
    }
    #[test]
    fn cancellation_expiration_and_keychain_failure_fail_closed() {
        let fixture = Arc::new(Mutex::new(Fixture {
            save_denied: true,
            ..Default::default()
        }));
        let mut app = account(&fixture);
        app.begin().unwrap();
        app.cancel();
        assert!(app.pending.is_none());
        app.begin().unwrap();
        app.pending.as_mut().unwrap().started = Instant::now() - Duration::from_secs(601);
        assert!(app.poll().is_err());
        assert!(app.pending.is_none());
        app.begin().unwrap();
        let pending = app.pending.as_ref().unwrap();
        let mut stream =
            std::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, pending.port)).unwrap();
        write!(
            stream,
            "GET /orven-auth/callback?code={}&state={} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
            "b".repeat(43),
            pending.state,
            pending.port
        )
        .unwrap();
        assert!(app.poll().is_err());
        assert!(fixture.lock().unwrap().credential.is_none());
        assert!(fixture.lock().unwrap().revoked);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod keychain_integration {
    #[test]
    #[ignore = "Explicitly exercises the real macOS Keychain with a disposable synthetic item"]
    fn native_keychain_roundtrip() {
        use security_framework::passwords::{
            delete_generic_password, get_generic_password, set_generic_password,
        };
        let service = format!("dev.orven.desktop.test.{}", uuid::Uuid::new_v4());
        let account = "synthetic-account";
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = delete_generic_password(&self.0, "synthetic-account");
            }
        }
        let _cleanup = Cleanup(service.clone());
        let secret = audit_core::desktop_auth::random_secret();
        assert!(set_generic_password(&service, account, secret.as_bytes()).is_ok());
        let restored = get_generic_password(&service, account).unwrap();
        assert!(restored == secret.as_bytes());
        assert!(delete_generic_password(&service, account).is_ok());
        assert!(get_generic_password(&service, account).is_err());
    }
}
