-- Stable upstream identity; existing users remain unlinked until explicitly migrated.
ALTER TABLE users ADD COLUMN github_account_id TEXT;
CREATE UNIQUE INDEX users_github_account ON users(github_account_id);

CREATE TABLE github_login_attempts (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX github_login_expiry ON github_login_attempts(expires_at);

CREATE TABLE browser_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX browser_session_expiry ON browser_sessions(expires_at);
