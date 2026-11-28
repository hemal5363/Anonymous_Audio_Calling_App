-- 011_settings_registry_and_call_snapshots.sql
-- 1. Snapshot columns for call_sessions at match time
-- 2. Audit log table for dynamic settings updates
-- 3. Migration of legacy composite app_settings rows to per-key layout (preserving subscription plans & existing values)

-- Step 1: Add snapshot columns to call_sessions
ALTER TABLE call_sessions
    ADD COLUMN IF NOT EXISTS snapshot_mode VARCHAR(32),
    ADD COLUMN IF NOT EXISTS snapshot_rate_per_minute NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS snapshot_ring_timeout INTEGER,
    ADD COLUMN IF NOT EXISTS snapshot_max_duration INTEGER,
    ADD COLUMN IF NOT EXISTS snapshot_currency VARCHAR(3) DEFAULT 'INR';

-- Step 2: Create settings_audit table
CREATE TABLE IF NOT EXISTS settings_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    admin_email VARCHAR(255) NOT NULL,
    key VARCHAR(64) NOT NULL,
    old_value JSONB,
    new_value JSONB NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    user_agent VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settings_audit_key ON settings_audit(key);
CREATE INDEX IF NOT EXISTS idx_settings_audit_created_at ON settings_audit(created_at DESC);

-- Step 3: Ensure description column in app_settings allows NULL or is optional
ALTER TABLE app_settings ALTER COLUMN description DROP NOT NULL;

-- Step 4: Stage unbundled settings from legacy composite rows
CREATE TEMP TABLE temp_unbundled_settings (
    key VARCHAR(64),
    value_json JSONB,
    updated_by UUID,
    updated_at TIMESTAMP WITH TIME ZONE
) ON COMMIT DROP;

-- 4a. Extract subscription_plans BEFORE deleting monetization
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'subscription_plans',
       CASE 
         WHEN value_json ? 'subscription_plans' AND jsonb_typeof(value_json->'subscription_plans') = 'array' AND jsonb_array_length(value_json->'subscription_plans') > 0
         THEN value_json->'subscription_plans'
         ELSE '[{"id": "1", "name": "Starter Pass", "price": 49.00, "duration_days": 30, "active": true}, {"id": "2", "name": "Unlimited Monthly", "price": 99.00, "duration_days": 30, "active": true}]'::jsonb
       END,
       updated_by, updated_at
FROM app_settings WHERE key = 'monetization';

-- If no monetization row exists, provide default subscription_plans
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'subscription_plans',
       '[{"id": "1", "name": "Starter Pass", "price": 49.00, "duration_days": 30, "active": true}, {"id": "2", "name": "Unlimited Monthly", "price": 99.00, "duration_days": 30, "active": true}]'::jsonb,
       NULL, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM temp_unbundled_settings WHERE key = 'subscription_plans');

-- 4b. Extract monetization scalar settings
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'monetization_mode', to_jsonb(COALESCE(value_json->>'mode', 'free')), updated_by, updated_at FROM app_settings WHERE key = 'monetization'
UNION ALL
SELECT 'billing_rate_per_minute', to_jsonb(COALESCE((value_json->>'per_minute_rate')::numeric, 1.00)), updated_by, updated_at FROM app_settings WHERE key = 'monetization'
UNION ALL
SELECT 'billing_minimum_balance', to_jsonb(COALESCE((value_json->>'minimum_balance')::numeric, 5.00)), updated_by, updated_at FROM app_settings WHERE key = 'monetization'
UNION ALL
SELECT 'free_daily_minute_cap', to_jsonb(COALESCE((value_json->>'free_daily_minute_cap')::numeric, 30)), updated_by, updated_at FROM app_settings WHERE key = 'monetization'
UNION ALL
SELECT 'free_trial_minutes_new_user', to_jsonb(COALESCE((value_json->>'free_trial_minutes_new_user')::numeric, 10)), updated_by, updated_at FROM app_settings WHERE key = 'monetization';

-- 4c. Extract auth_settings
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'email_login_enabled', to_jsonb(COALESCE((value_json->>'email_login_enabled')::boolean, true)), updated_by, updated_at FROM app_settings WHERE key = 'auth_settings'
UNION ALL
SELECT 'mobile_login_enabled', to_jsonb(COALESCE((value_json->>'mobile_login_enabled')::boolean, false)), updated_by, updated_at FROM app_settings WHERE key = 'auth_settings'
UNION ALL
SELECT 'otp_expiry_seconds', to_jsonb(COALESCE((value_json->>'otp_expiry_seconds')::numeric, 300)), updated_by, updated_at FROM app_settings WHERE key = 'auth_settings'
UNION ALL
SELECT 'otp_max_verify_attempts', to_jsonb(COALESCE((value_json->>'max_otp_attempts')::numeric, 3)), updated_by, updated_at FROM app_settings WHERE key = 'auth_settings';

-- 4d. Extract matching_settings
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'ring_timeout_seconds', to_jsonb(COALESCE((value_json->>'ring_timeout_seconds')::numeric, 30)), updated_by, updated_at FROM app_settings WHERE key = 'matching_settings'
UNION ALL
SELECT 'max_match_attempts', to_jsonb(COALESCE((value_json->>'max_match_attempts')::numeric, 3)), updated_by, updated_at FROM app_settings WHERE key = 'matching_settings'
UNION ALL
SELECT 'try_live_presence_first', to_jsonb(COALESCE((value_json->>'try_live_presence_first')::boolean, true)), updated_by, updated_at FROM app_settings WHERE key = 'matching_settings'
UNION ALL
SELECT 'cooldown_same_peer_seconds', to_jsonb(COALESCE((value_json->>'cooldown_same_peer_seconds')::numeric, 60)), updated_by, updated_at FROM app_settings WHERE key = 'matching_settings';

-- 4e. Extract moderation and moderation_settings
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'auto_flag_report_threshold', to_jsonb(COALESCE((value_json->>'flag_report_threshold')::numeric, 3)), updated_by, updated_at FROM app_settings WHERE key = 'moderation'
UNION ALL
SELECT 'auto_suspend_report_threshold', to_jsonb(COALESCE((value_json->>'auto_suspend_report_threshold')::numeric, 5)), updated_by, updated_at FROM app_settings WHERE key = 'moderation_settings'
UNION ALL
SELECT 'auto_suspend_window_hours', to_jsonb(COALESCE((value_json->>'auto_suspend_window_hours')::numeric, 24)), updated_by, updated_at FROM app_settings WHERE key = 'moderation_settings'
UNION ALL
SELECT 'auto_suspension_duration_hours', to_jsonb(COALESCE((value_json->>'suspension_duration_hours')::numeric, 48)), updated_by, updated_at FROM app_settings WHERE key = 'moderation_settings';

-- 4f. Extract retention
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'call_history_retention_days', to_jsonb(COALESCE((value_json->>'call_history_retention_days')::numeric, 90)), updated_by, updated_at FROM app_settings WHERE key = 'retention'
UNION ALL
SELECT 'availability_grace_period_minutes', to_jsonb(COALESCE((value_json->>'availability_grace_period_minutes')::numeric, 60)), updated_by, updated_at FROM app_settings WHERE key = 'retention';

-- Step 5: Delete legacy composite rows
DELETE FROM app_settings WHERE key IN ('monetization', 'auth_settings', 'matching_settings', 'moderation', 'moderation_settings', 'retention');

-- Step 6: Upsert unbundled settings
INSERT INTO app_settings (key, value_json, updated_by, updated_at)
SELECT key, value_json, updated_by, updated_at FROM temp_unbundled_settings
ON CONFLICT (key) DO UPDATE
SET value_json = EXCLUDED.value_json,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

-- Step 7: Record audit entry for migration
INSERT INTO settings_audit (admin_email, key, old_value, new_value, ip_address, user_agent)
SELECT 'system:migration:011', key, 'null'::jsonb, value_json, '127.0.0.1', 'Migration 011'
FROM app_settings;
