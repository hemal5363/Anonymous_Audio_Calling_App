-- 001_initial_schema.sql
-- Migration: Initial Schema for Anonymous Audio Calling App
-- Generated from docs/DB_SCHEMA.md

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------
-- 1. admin_users
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'admin' CHECK (role IN ('superadmin', 'admin', 'moderator')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    totp_secret VARCHAR(128) NULL,
    last_login_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);

-- ----------------------------------------------------------------------
-- 2. app_settings
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(64) PRIMARY KEY,
    value_json JSONB NOT NULL,
    description TEXT NULL,
    updated_by UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------
-- 3. users
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NULL UNIQUE,
    phone VARCHAR(32) NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned', 'deleted')),
    is_available BOOLEAN NOT NULL DEFAULT FALSE,
    available_changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    push_token TEXT NULL,
    age_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    terms_version VARCHAR(16) NOT NULL DEFAULT '1.0',
    privacy_version VARCHAR(16) NOT NULL DEFAULT '1.0',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT chk_identity_present CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_users_available_matching 
ON users (is_available, status, available_changed_at) 
WHERE status = 'active' AND is_available = TRUE;

CREATE INDEX IF NOT EXISTS idx_users_push_reachable 
ON users (id) 
WHERE push_token IS NOT NULL AND status = 'active' AND is_available = TRUE;

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ----------------------------------------------------------------------
-- 3b. refresh_tokens
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ----------------------------------------------------------------------
-- 4. otp_codes
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target VARCHAR(255) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(32) NOT NULL DEFAULT 'login' CHECK (purpose IN ('login', 'verification', 'password_reset')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otp_target_active 
ON otp_codes (target, expires_at, is_used) 
WHERE is_used = FALSE;

-- ----------------------------------------------------------------------
-- 5. plans
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) NOT NULL,
    description TEXT NULL,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    duration_days INT NOT NULL DEFAULT 30,
    daily_minute_cap INT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(is_active);

-- ----------------------------------------------------------------------
-- 6. subscriptions
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
    starts_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at TIMESTAMPTZ NOT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase', 'admin_grant', 'promotion')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions (user_id, status, ends_at);

-- ----------------------------------------------------------------------
-- 7. wallets
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    balance_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (balance_amount >= 0),
    balance_minutes INT NOT NULL DEFAULT 0 CHECK (balance_minutes >= 0),
    free_trial_minutes INT NOT NULL DEFAULT 0 CHECK (free_trial_minutes >= 0),
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);

-- ----------------------------------------------------------------------
-- 8. wallet_transactions
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('credit', 'debit', 'refund', 'bonus')),
    amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    minutes INT NOT NULL DEFAULT 0,
    call_session_id UUID NULL,
    reason VARCHAR(255) NOT NULL,
    created_by_admin_id UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------
-- 9. call_sessions
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_code VARCHAR(36) NOT NULL UNIQUE,
    caller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    callee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'requested' 
        CHECK (status IN ('requested', 'ringing', 'connected', 'ended', 'declined', 'missed', 'failed')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    connected_at TIMESTAMPTZ NULL,
    ended_at TIMESTAMPTZ NULL,
    duration_seconds INT NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    end_reason VARCHAR(32) NULL 
        CHECK (end_reason IN (
            'caller_hangup', 'callee_hangup', 'declined', 'ring_timeout', 
            'skipped', 'balance_exhausted', 'network_error', 'system_shutdown'
        )),
    billing_mode VARCHAR(20) NOT NULL DEFAULT 'free' CHECK (billing_mode IN ('free', 'subscription', 'per_minute')),
    amount_charged NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    minutes_charged INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_caller_callee_distinct CHECK (caller_id <> callee_id)
);

-- Safely add FK from wallet_transactions to call_sessions if not existing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_wallet_tx_call'
    ) THEN
        ALTER TABLE wallet_transactions 
        ADD CONSTRAINT fk_wallet_tx_call 
        FOREIGN KEY (call_session_id) REFERENCES call_sessions(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_created ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_id ON wallet_transactions(wallet_id);

CREATE INDEX IF NOT EXISTS idx_call_sessions_active 
ON call_sessions (caller_id, callee_id, status) 
WHERE status IN ('requested', 'ringing', 'connected');

CREATE INDEX IF NOT EXISTS idx_call_sessions_caller_history ON call_sessions (caller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_callee_history ON call_sessions (callee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_pair_recent ON call_sessions (caller_id, callee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_code ON call_sessions (call_code);

-- ----------------------------------------------------------------------
-- 10. reports
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_session_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reported_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason VARCHAR(32) NOT NULL 
        CHECK (reason IN ('harassment', 'abusive_language', 'sexual_content', 'scam', 'underage', 'spam', 'other')),
    note TEXT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
    action_taken VARCHAR(32) NULL CHECK (action_taken IN ('none', 'warning', 'suspension', 'ban')),
    handled_by UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ NULL,
    CONSTRAINT chk_reporter_reported_distinct CHECK (reporter_id <> reported_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_queue ON reports (status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user ON reports (reported_id, status);

-- ----------------------------------------------------------------------
-- 11. blocks
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_blocker_blocked UNIQUE (blocker_id, blocked_id),
    CONSTRAINT chk_blocker_blocked_distinct CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_forward ON blocks (blocker_id, blocked_id);
CREATE INDEX IF NOT EXISTS idx_blocks_reverse ON blocks (blocked_id, blocker_id);
