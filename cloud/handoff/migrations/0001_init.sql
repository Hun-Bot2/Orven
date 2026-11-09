PRAGMA foreign_keys = ON;

-- TODO 1: users 테이블
CREATE TABLE users (
    user_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
);

-- TODO 2: targets 테이블
CREATE TABLE targets (
    target_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    disabled_at INTEGER,

    FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    UNIQUE (user_id, target_id),

    CHECK (
        disabled_at IS NULL
        OR disabled_at >= created_at
    )
);

-- TODO 3: handoffs 테이블
CREATE TABLE handoffs (
    handoff_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    target_id TEXT NOT NULL,

    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    content_hash TEXT NOT NULL,

    title TEXT NOT NULL,
    content_markdown TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'queued',

    claimed_by TEXT,
    lease_expires_at INTEGER,

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    -- TODO: UNIQUE(user_id, target_id, idempotency_key)
    UNIQUE(user_id, target_id, idempotency_key),
    -- TODO: FOREIGN KEY(user_id, target_id)
    FOREIGN KEY(user_id, target_id) REFERENCES targets(user_id, target_id) ON DELETE RESTRICT,
-- TODO: CHECK(status IN (...))
    CHECK (
        status IN (
        'queued',
        'claimed',
        'awaiting_local_approval',
        'written',
        'rejected',
        'expired'
        )
    ),
    -- 시간 무결성 (Unix milliseconds)
    CHECK (expires_at > created_at),
    CHECK (updated_at >= created_at),

    -- 필수 문자열
    CHECK (length(trim(title)) > 0),
    CHECK (length(trim(idempotency_key)) > 0),
    CHECK (length(trim(content_markdown)) > 0),

    -- SHA-256 hex 문자열의 기본 길이 검사
    CHECK (length(payload_hash) = 64),
    CHECK (length(content_hash) = 64),

    -- Claim 정보의 일관성
    CHECK (
        (
            status IN ('claimed', 'awaiting_local_approval')
            AND claimed_by IS NOT NULL
            AND lease_expires_at IS NOT NULL
        )
        OR
        (
            status NOT IN ('claimed', 'awaiting_local_approval')
            AND claimed_by IS NULL
            AND lease_expires_at IS NULL
        )
    )
);

-- TODO 4: Inbox 조회 인덱스
-- CREATE INDEX idx_handoffs_inbox ON handoffs (user_id, target_id, status, expires_at);
CREATE INDEX idx_handoffs_inbox ON handoffs (user_id,status,created_at DESC);
-- TODO 5: 만료 처리 인덱스
CREATE INDEX expiry_idx ON handoffs (expires_at);



