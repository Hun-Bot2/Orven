-- Provider profile is display metadata; github_account_id remains the identity key.
ALTER TABLE users ADD COLUMN github_username TEXT;
ALTER TABLE github_login_attempts ADD COLUMN desktop_flow_id TEXT;

CREATE TABLE desktop_login_flows (
  flow_id TEXT PRIMARY KEY,
  code_challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  code_hash TEXT UNIQUE
);
CREATE INDEX desktop_flow_expiry ON desktop_login_flows(expires_at);
CREATE TABLE desktop_credentials (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX desktop_credential_expiry ON desktop_credentials(expires_at);
