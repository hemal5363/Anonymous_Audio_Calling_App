-- Migration: 010_matching_cooldown_settings.sql
-- Configurable same-peer rematch cooldown in app_settings.
-- Sets default cooldown_same_peer_seconds to 60 if row is missing or still default 1800,
-- without overwriting any custom value deliberately changed by an administrator.

-- 1. Ensure matching_settings row exists in app_settings
INSERT INTO app_settings (key, value_json, description)
VALUES (
    'matching_settings',
    '{"ring_timeout_seconds": 30, "max_match_attempts": 3, "cooldown_same_peer_seconds": 60, "try_live_presence_first": true}'::jsonb,
    'Matching engine thresholds and retry limits'
)
ON CONFLICT (key) DO NOTHING;

-- 2. Update cooldown_same_peer_seconds to 60 if missing or still default 1800
UPDATE app_settings
SET value_json = jsonb_set(
    value_json,
    '{cooldown_same_peer_seconds}',
    '60'::jsonb,
    true
),
updated_at = CURRENT_TIMESTAMP
WHERE key = 'matching_settings'
  AND (
    value_json->>'cooldown_same_peer_seconds' IS NULL
    OR value_json->>'cooldown_same_peer_seconds' = '1800'
  );
