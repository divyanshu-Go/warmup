CREATE TABLE IF NOT EXISTS resume_uploads (
    id UUID PRIMARY KEY,
    filename TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    parsed_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE resume_uploads ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id);

CREATE TABLE IF NOT EXISTS email_verifications (
    email TEXT PRIMARY KEY,
    resume_id UUID NOT NULL REFERENCES resume_uploads(id),
    code_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_users(id),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS interview_turns (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_users(id),
    resume_id UUID NOT NULL REFERENCES resume_uploads(id),
    kind TEXT NOT NULL CHECK (kind IN ('technical', 'hr')),
    difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
    question TEXT NOT NULL,
    answer TEXT,
    score SMALLINT CHECK (score BETWEEN 0 AND 10),
    feedback TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    answered_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS interview_one_pending_turn
    ON interview_turns (user_id, resume_id) WHERE answer IS NULL;

ALTER TABLE interview_turns ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE interview_turns ADD COLUMN IF NOT EXISTS audio_sha256 TEXT;

-- Returning-user sign-in is independent of resume-link verification challenges.
CREATE TABLE IF NOT EXISTS sign_in_codes (
    email TEXT PRIMARY KEY REFERENCES app_users(email),
    code_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL
);
