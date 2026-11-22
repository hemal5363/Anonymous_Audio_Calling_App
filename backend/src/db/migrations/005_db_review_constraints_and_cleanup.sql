-- ----------------------------------------------------------------------
-- 005_db_review_constraints_and_cleanup.sql
-- Missing constraints, ON DELETE behaviors, matching indexes, and retention settings
-- ----------------------------------------------------------------------

-- 1. Unique constraint on plans.name
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_plans_name') THEN
        ALTER TABLE plans ADD CONSTRAINT uq_plans_name UNIQUE (name);
    END IF;
END $$;

-- 2. Unique constraint on reports (call_session_id, reporter_id) to prevent duplicate reports
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_reports_call_reporter') THEN
        ALTER TABLE reports ADD CONSTRAINT uq_reports_call_reporter UNIQUE (call_session_id, reporter_id);
    END IF;
END $$;

-- 3. Update users table identity check constraint to accommodate deleted accounts
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_identity_present;
ALTER TABLE users ADD CONSTRAINT chk_identity_present 
    CHECK (status = 'deleted' OR email IS NOT NULL OR phone IS NOT NULL);

-- 4. Foreign key ON DELETE behaviors for call_sessions
-- Allow caller_id and callee_id to be NULL so historical call records remain anonymous when a user deletes their account
ALTER TABLE call_sessions ALTER COLUMN caller_id DROP NOT NULL;
ALTER TABLE call_sessions ALTER COLUMN callee_id DROP NOT NULL;

ALTER TABLE call_sessions DROP CONSTRAINT IF EXISTS call_sessions_caller_id_fkey;
ALTER TABLE call_sessions DROP CONSTRAINT IF EXISTS call_sessions_callee_id_fkey;
ALTER TABLE call_sessions DROP CONSTRAINT IF EXISTS fk_call_sessions_caller;
ALTER TABLE call_sessions DROP CONSTRAINT IF EXISTS fk_call_sessions_callee;

ALTER TABLE call_sessions ADD CONSTRAINT fk_call_sessions_caller 
    FOREIGN KEY (caller_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE call_sessions ADD CONSTRAINT fk_call_sessions_callee 
    FOREIGN KEY (callee_id) REFERENCES users(id) ON DELETE SET NULL;

-- 5. Foreign key ON DELETE behaviors for reports
-- Allow reporter_id and reported_id to be NULL on user account deletion while preserving moderation records
ALTER TABLE reports ALTER COLUMN reporter_id DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN reported_id DROP NOT NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reporter_id_fkey;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reported_id_fkey;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS fk_reports_reporter;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS fk_reports_reported;

ALTER TABLE reports ADD CONSTRAINT fk_reports_reporter 
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reports ADD CONSTRAINT fk_reports_reported 
    FOREIGN KEY (reported_id) REFERENCES users(id) ON DELETE SET NULL;

-- 6. Indexes for matching queries (is_available, status)
CREATE INDEX IF NOT EXISTS idx_users_matching_active 
ON users (status, is_available, available_changed_at) 
WHERE status = 'active' AND is_available = TRUE;

CREATE INDEX IF NOT EXISTS idx_call_sessions_busy_check 
ON call_sessions (status, caller_id, callee_id) 
WHERE status IN ('requested', 'ringing', 'connected');

CREATE INDEX IF NOT EXISTS idx_call_sessions_stuck_cleanup 
ON call_sessions (status, requested_at) 
WHERE status IN ('ringing', 'connected');

-- 7. Index for OTP cleanup
CREATE INDEX IF NOT EXISTS idx_otp_cleanup 
ON otp_codes (expires_at, is_used);

-- 8. Index for call history data retention
CREATE INDEX IF NOT EXISTS idx_call_sessions_retention 
ON call_sessions (ended_at) 
WHERE status = 'ended';

-- 9. Add default retention and availability grace period settings in app_settings
INSERT INTO app_settings (key, value_json, description)
VALUES (
    'retention',
    '{"call_history_retention_days": 90, "availability_grace_period_minutes": 60}'::jsonb,
    'Data retention policy and user availability grace period settings'
)
ON CONFLICT (key) DO NOTHING;
