# Database Schema Specification

**Database Engine:** PostgreSQL 14+  
**Target:** Anonymous Audio Calling App (MVP)  
**File Location:** `docs/DB_SCHEMA.md`  

---

## 1. Text Entity-Relationship (ER) Summary

The database uses UUID primary keys generated via PostgreSQL `gen_random_uuid()` and UTC timestamps (`TIMESTAMPTZ`). Relationships enforce strict referential integrity while isolating user identity from call peers.

```
+--------------------------------------------------------------------------------------------------+
|                                    ENTITY RELATIONSHIPS                                          |
+--------------------------------------------------------------------------------------------------+

  admin_users (1) <-----------------+ (0..*) app_settings (updated_by)
       |                            + (0..*) reports (handled_by)
       |                            + (0..*) wallet_transactions (created_by_admin_id)
       |
  users (1) ------------------------+ (0..1) wallets (user_id) [1:1]
       |                            + (0..*) wallet_transactions (user_id) [1:N]
       |                            + (0..*) subscriptions (user_id) [1:N]
       |                            + (0..*) blocks (as blocker or blocked) [1:N]
       |                            + (0..*) reports (as reporter or reported) [1:N]
       |                            + (0..*) call_sessions (as caller or callee) [1:N]
       |
  plans (1) ------------------------+ (0..*) subscriptions (plan_id) [1:N]
       |
  wallets (1) ----------------------+ (0..*) wallet_transactions (wallet_id) [1:N]
       |
  call_sessions (1) ----------------+ (0..*) reports (call_session_id) [1:N]
       |                            + (0..*) wallet_transactions (call_session_id) [1:N]
       |
  otp_codes (Standalone) -----------> Short-lived auth challenge verification for phone/email
```

### Key Cardinalities and Rules
- **users to wallets (1:1):** Every user is assigned exactly one wallet record upon registration for tracking balances and trial minutes.
- **users to call_sessions (1:N):** A user can participate in many calls either as `caller_id` or `callee_id`.
- **users to blocks (1:N):** A directed pair `(blocker_id, blocked_id)`. Matching queries evaluate blocks bidirectionally to ensure neither party connects again.
- **call_sessions to reports (1:N):** A call session can be reported by either participant, referencing the specific `call_session_id`.
- **plans to subscriptions (1:N):** Admin defines subscription tiers; active user subscriptions reference an assigned plan.
- **app_settings & admin_users:** System configuration values (monetization mode, login switches, rates) managed by admins with an audit trail.

---

## 2. Matching Engine & Indexing Strategy

When a user taps **Call**, the backend executes a fast random matching query to find an available candidate. The matching candidate must satisfy:
1. `users.id <> :caller_id`
2. `users.status = 'active'`
3. `users.is_available = TRUE`
4. User is not currently engaged in an active call (`status IN ('requested', 'ringing', 'connected')`).
5. Neither user has blocked the other (`NOT EXISTS` in `blocks` bidirectionally).
6. Users have not recently connected (optional MVP cooldown filter).

### Fields Indexed for Matching
To ensure sub-50ms query latency on single-node free-tier hosting (AWS EC2 t2/t3.micro), the following targeted indexes are maintained:

1. **`idx_users_available_matching` on `users(is_available, status)`:**
   - **Type:** Partial B-tree index: `WHERE status = 'active' AND is_available = TRUE`.
   - **Purpose:** Restricts search to only active, available candidates, keeping index size minimal and cached in RAM.
2. **`idx_users_push_token` on `users(push_token)`:**
   - **Type:** B-tree index: `WHERE push_token IS NOT NULL`.
   - **Purpose:** Quick reachability fallback for closed/background apps when no live WebSocket user is available.
3. **`idx_blocks_bidirectional` on `blocks(blocker_id, blocked_id)` and `blocks(blocked_id, blocker_id)`:**
   - **Purpose:** Immediate index-only lookups for exclusion filters during candidate evaluation.
4. **`idx_call_sessions_active` on `call_sessions(caller_id, callee_id, status)`:**
   - **Type:** Partial index: `WHERE status IN ('requested', 'ringing', 'connected')`.
   - **Purpose:** Instant verification that neither candidate is busy on another call.

---

## 3. PostgreSQL Schema (DDL)

```sql
-- Anonymous Audio Calling App - PostgreSQL DDL Schema (MVP)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------
-- 1. admin_users
-- ----------------------------------------------------------------------
CREATE TABLE admin_users (
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

CREATE INDEX idx_admin_users_email ON admin_users(email);

-- ----------------------------------------------------------------------
-- 2. app_settings
-- ----------------------------------------------------------------------
CREATE TABLE app_settings (
    key VARCHAR(64) PRIMARY KEY,
    value_json JSONB NOT NULL,
    description TEXT NULL,
    updated_by UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------
-- 3. users
-- ----------------------------------------------------------------------
CREATE TABLE users (
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

-- Primary matching index: partial index on eligible available candidates
CREATE INDEX idx_users_available_matching 
ON users (is_available, status, available_changed_at) 
WHERE status = 'active' AND is_available = TRUE;

-- Push token lookup index for waking background/closed apps
CREATE INDEX idx_users_push_reachable 
ON users (id) 
WHERE push_token IS NOT NULL AND status = 'active' AND is_available = TRUE;

CREATE INDEX idx_users_status ON users(status);

-- ----------------------------------------------------------------------
-- 4. otp_codes
-- ----------------------------------------------------------------------
CREATE TABLE otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target VARCHAR(255) NOT NULL, -- Phone number or email
    code_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(32) NOT NULL DEFAULT 'login' CHECK (purpose IN ('login', 'verification', 'password_reset')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_otp_target_active 
ON otp_codes (target, expires_at, is_used) 
WHERE is_used = FALSE;

-- ----------------------------------------------------------------------
-- 5. plans
-- ----------------------------------------------------------------------
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) NOT NULL,
    description TEXT NULL,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    duration_days INT NOT NULL DEFAULT 30,
    daily_minute_cap INT NULL, -- NULL means unlimited minutes
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_plans_active ON plans(is_active);

-- ----------------------------------------------------------------------
-- 6. subscriptions
-- ----------------------------------------------------------------------
CREATE TABLE subscriptions (
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

CREATE INDEX idx_subscriptions_user_status ON subscriptions (user_id, status, ends_at);

-- ----------------------------------------------------------------------
-- 7. wallets
-- ----------------------------------------------------------------------
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    balance_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (balance_amount >= 0),
    balance_minutes INT NOT NULL DEFAULT 0 CHECK (balance_minutes >= 0),
    free_trial_minutes INT NOT NULL DEFAULT 0 CHECK (free_trial_minutes >= 0),
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wallets_user ON wallets(user_id);

-- ----------------------------------------------------------------------
-- 8. wallet_transactions
-- ----------------------------------------------------------------------
CREATE TABLE wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('credit', 'debit', 'refund', 'bonus')),
    amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    minutes INT NOT NULL DEFAULT 0,
    call_session_id UUID NULL, -- FK added after call_sessions table creation
    reason VARCHAR(255) NOT NULL,
    created_by_admin_id UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wallet_tx_user_created ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX idx_wallet_tx_wallet_id ON wallet_transactions(wallet_id);

-- ----------------------------------------------------------------------
-- 9. call_sessions
-- ----------------------------------------------------------------------
CREATE TABLE call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_code VARCHAR(36) NOT NULL UNIQUE, -- Random public token exchanged with clients
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

-- Add foreign key constraint back to wallet_transactions
ALTER TABLE wallet_transactions 
ADD CONSTRAINT fk_wallet_tx_call 
FOREIGN KEY (call_session_id) REFERENCES call_sessions(id) ON DELETE SET NULL;

-- Matching exclusion index: verify user is not currently in a call
CREATE INDEX idx_call_sessions_active 
ON call_sessions (caller_id, callee_id, status) 
WHERE status IN ('requested', 'ringing', 'connected');

-- Call history indexes for billing, audit and cooldown
CREATE INDEX idx_call_sessions_caller_history ON call_sessions (caller_id, created_at DESC);
CREATE INDEX idx_call_sessions_callee_history ON call_sessions (callee_id, created_at DESC);
CREATE INDEX idx_call_sessions_pair_recent ON call_sessions (caller_id, callee_id, created_at DESC);
CREATE INDEX idx_call_sessions_code ON call_sessions (call_code);

-- ----------------------------------------------------------------------
-- 10. reports
-- ----------------------------------------------------------------------
CREATE TABLE reports (
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

CREATE INDEX idx_reports_queue ON reports (status, created_at ASC);
CREATE INDEX idx_reports_reported_user ON reports (reported_id, status);

-- ----------------------------------------------------------------------
-- 11. blocks
-- ----------------------------------------------------------------------
CREATE TABLE blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_blocker_blocked UNIQUE (blocker_id, blocked_id),
    CONSTRAINT chk_blocker_blocked_distinct CHECK (blocker_id <> blocked_id)
);

-- Bidirectional matching indexes: ensures instant exclusion during matching query
CREATE INDEX idx_blocks_forward ON blocks (blocker_id, blocked_id);
CREATE INDEX idx_blocks_reverse ON blocks (blocked_id, blocker_id);
```

---

## 4. Default System Seed Data

```sql
-- Seed initial app_settings for MVP operation
INSERT INTO app_settings (key, value_json, description) VALUES
(
    'monetization',
    '{
        "mode": "free",
        "per_minute_rate": 1.00,
        "currency": "INR",
        "free_trial_minutes_new_user": 10,
        "free_daily_minute_cap": 30
    }'::jsonb,
    'Active monetization mode (free, subscription, or per_minute) and pricing parameters'
),
(
    'auth_settings',
    '{
        "email_login_enabled": true,
        "mobile_login_enabled": false,
        "otp_expiry_seconds": 300,
        "max_otp_attempts": 3
    }'::jsonb,
    'Controls allowed authentication methods and OTP restrictions'
),
(
    'matching_settings',
    '{
        "ring_timeout_seconds": 30,
        "max_match_attempts": 3,
        "cooldown_same_peer_seconds": 1800,
        "try_live_presence_first": true
    }'::jsonb,
    'Matching engine thresholds and retry limits'
),
(
    'moderation_settings',
    '{
        "auto_suspend_report_threshold": 3,
        "auto_suspend_window_hours": 24,
        "suspension_duration_hours": 48
    }'::jsonb,
    'Automated safety and moderation enforcement rules'
)
ON CONFLICT (key) DO NOTHING;

-- Seed default plans
INSERT INTO plans (name, description, price, currency, duration_days, daily_minute_cap, is_active) VALUES
('Starter Free Plan', 'Basic tier with daily allowance', 0.00, 'INR', 30, 15, TRUE),
('Unlimited Monthly', 'Unlimited anonymous audio calling for 30 days', 99.00, 'INR', 30, NULL, TRUE)
ON CONFLICT DO NOTHING;
```

---

## 5. Candidate Matching Query Blueprint

The query below illustrates how the indexes defined in `idx_users_available_matching`, `idx_call_sessions_active`, and `idx_blocks_forward` / `idx_blocks_reverse` optimize the partner selection process:

```sql
-- Fast matching candidate selector
SELECT u.id, u.push_token
FROM users u
WHERE u.status = 'active'
  AND u.is_available = TRUE
  AND u.id <> :caller_id
  -- 1. Candidate is not currently in an active call
  AND NOT EXISTS (
      SELECT 1 FROM call_sessions cs
      WHERE (cs.caller_id = u.id OR cs.callee_id = u.id)
        AND cs.status IN ('requested', 'ringing', 'connected')
  )
  -- 2. Neither user has blocked the other
  AND NOT EXISTS (
      SELECT 1 FROM blocks b
      WHERE (b.blocker_id = :caller_id AND b.blocked_id = u.id)
         OR (b.blocker_id = u.id AND b.blocked_id = :caller_id)
  )
  -- 3. Avoid immediate rematch with the same user (e.g. past 30 mins)
  AND NOT EXISTS (
      SELECT 1 FROM call_sessions cs_recent
      WHERE ((cs_recent.caller_id = :caller_id AND cs_recent.callee_id = u.id)
          OR (cs_recent.caller_id = u.id AND cs_recent.callee_id = :caller_id))
        AND cs_recent.created_at > (CURRENT_TIMESTAMP - INTERVAL '30 minutes')
  )
ORDER BY RANDOM()
LIMIT 1;
```
