-- ----------------------------------------------------------------------
-- 004_user_flagged_and_admin_lockout.sql
-- Add user auto-moderation flagging and admin brute-force lockout columns
-- ----------------------------------------------------------------------

-- 1. Add is_flagged to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Allow 'flagged' status in users table
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check 
    CHECK (status IN ('active', 'suspended', 'banned', 'deleted', 'flagged'));

-- 3. Add failed login attempts and lockout fields to admin_users table
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ NULL;

-- 4. Default moderation setting for distinct report threshold
INSERT INTO app_settings (key, value_json, description)
VALUES ('moderation', '{"flag_report_threshold": 3}'::jsonb, 'Auto-moderation safety settings')
ON CONFLICT (key) DO NOTHING;
