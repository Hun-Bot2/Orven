//! Desktop sign-in policy. No repository access, provider credentials or OS storage.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

pub const CALLBACK_PATH: &str = "/orven-auth/callback";
pub const LOGIN_SECONDS: u64 = 600;

pub fn random_secret() -> String {
    // Two OS-random UUID v4 values provide 244 random bits.
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
pub fn valid_origin(origin: &str) -> bool {
    Url::parse(origin)
        .is_ok_and(|url| url.scheme() == "https" && url.origin().ascii_serialization() == origin)
}
pub fn sign_in_url(
    origin: &str,
    port: u16,
    state: &str,
    verifier: &str,
) -> Result<Url, &'static str> {
    if !valid_origin(origin) || port < 1024 {
        return Err("Invalid authentication configuration");
    }
    let mut url = Url::parse(&format!("{origin}/auth/desktop/start"))
        .map_err(|_| "Invalid authentication configuration")?;
    url.query_pairs_mut()
        .append_pair("port", &port.to_string())
        .append_pair("state", state)
        .append_pair("code_challenge", &challenge(verifier));
    Ok(url)
}

/// Accept only the exact bound IPv4 endpoint and state, with a single opaque code.
/// HTTP body/cookies and arbitrary browser-supplied paths are never interpreted.
pub fn callback_code(headers: &str, port: u16, state: &str) -> Option<String> {
    if headers.len() > 4096 || !headers.ends_with("\r\n\r\n") {
        return None;
    }
    let mut lines = headers.split("\r\n");
    let first: Vec<_> = lines.next()?.split(' ').collect();
    if first.len() != 3 || first[0] != "GET" || first[2] != "HTTP/1.1" || !first[1].starts_with('/')
    {
        return None;
    }
    if first[1].split('?').next() != Some(CALLBACK_PATH) {
        return None;
    }
    let mut host = None;
    for line in lines.filter(|line| !line.is_empty()) {
        let (key, value) = line.split_once(':')?;
        if key.eq_ignore_ascii_case("host") {
            if host.is_some() {
                return None;
            }
            host = Some(value.trim());
        }
        // Never let a web origin POST/fetch into the callback or attach a body.
        if key.eq_ignore_ascii_case("origin")
            || key.eq_ignore_ascii_case("transfer-encoding")
            || key.eq_ignore_ascii_case("content-length")
        {
            return None;
        }
    }
    if host != Some(format!("127.0.0.1:{port}").as_str()) {
        return None;
    }
    let url = Url::parse(&format!("http://127.0.0.1:{port}{}", first[1])).ok()?;
    if url.host_str() != Some("127.0.0.1")
        || url.port() != Some(port)
        || url.path() != CALLBACK_PATH
        || url.fragment().is_some()
    {
        return None;
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    if pairs.len() != 2 {
        return None;
    }
    let received = pairs.iter().find(|(k, _)| k == "state")?.1.as_ref();
    let code = pairs.iter().find(|(k, _)| k == "code")?.1.as_ref();
    if received != state || !opaque_code(code) {
        return None;
    }
    Some(code.to_owned())
}
pub fn opaque_code(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub user_id: String,
    pub github_account_id: String,
    pub username: String,
    pub avatar_url: String,
}
impl Profile {
    /// Only the verified account may supply the fixed-host, bounded-size avatar URL.
    pub fn avatar_request_url(&self) -> Option<String> {
        self.validate()
            .then(|| format!("{}&s=128", self.avatar_url))
    }

    pub fn validate(&self) -> bool {
        uuid::Uuid::parse_str(&self.user_id).is_ok()
            && self
                .github_account_id
                .parse::<u64>()
                .is_ok_and(|id| id > 0 && id.to_string() == self.github_account_id)
            && !self.username.is_empty()
            && self.username.len() <= 39
            && self
                .username
                .bytes()
                .enumerate()
                .all(|(i, c)| c.is_ascii_alphanumeric() || (i > 0 && c == b'-'))
            && self.avatar_url
                == format!(
                    "https://avatars.githubusercontent.com/u/{}?v=4",
                    self.github_account_id
                )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origin_and_pkce_policy() {
        assert!(valid_origin("https://orven.example"));
        for origin in [
            "http://orven.example",
            "https://orven.example/",
            "https://name:secret@orven.example",
            "https://orven.example/?x=y",
        ] {
            assert!(!valid_origin(origin));
        }
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let verifier = random_secret();
        let url = sign_in_url("https://orven.example", 45123, &random_secret(), &verifier).unwrap();
        assert!(!url.as_str().contains(&verifier));
        assert!(sign_in_url("https://orven.example", 80, "state", "verifier").is_err());
    }
    #[test]
    fn callback_is_strictly_bound() {
        let code = "a".repeat(43);
        let good = format!(
            "GET {CALLBACK_PATH}?code={code}&state=expected HTTP/1.1\r\nHost: 127.0.0.1:45123\r\n\r\n"
        );
        assert_eq!(callback_code(&good, 45123, "expected"), Some(code));
        for bad in [
            good.replace("expected", "wrong"),
            good.replace("GET", "POST"),
            good.replace("127.0.0.1", "attacker.example"),
            good.replace("45123", "45124"),
            good.replace("&state=", "&code=duplicate&state="),
            good.replace("/orven-auth/callback", "/other"),
            good.replace("\r\n\r\n", "\r\nOrigin: https://attacker.example\r\n\r\n"),
            good.replace("\r\n\r\n", "\r\nHost: 127.0.0.1:45123\r\n\r\n"),
        ] {
            assert!(callback_code(&bad, 45123, "expected").is_none());
        }
    }
    #[test]
    fn profile_rejects_untrusted_avatar_and_identity() {
        let mut profile = Profile {
            user_id: uuid::Uuid::new_v4().to_string(),
            github_account_id: "42".into(),
            username: "fixture".into(),
            avatar_url: "https://avatars.githubusercontent.com/u/42?v=4".into(),
        };
        assert!(profile.validate());
        assert_eq!(
            profile.avatar_request_url().as_deref(),
            Some("https://avatars.githubusercontent.com/u/42?v=4&s=128")
        );
        profile.avatar_url = "https://attacker.example/avatar".into();
        assert!(!profile.validate());
        assert!(profile.avatar_request_url().is_none());
        profile.avatar_url = "https://avatars.githubusercontent.com/u/42?v=4".into();
        profile.username = "<script>".into();
        assert!(!profile.validate());
    }
}
