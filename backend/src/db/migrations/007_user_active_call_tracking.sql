-- Migration 007: Atomic active call tracking on users table
-- Ensures mathematically impossible concurrency collisions across caller/callee roles

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS active_call_code VARCHAR(36) NULL;

CREATE INDEX IF NOT EXISTS idx_users_active_call_code 
ON users (active_call_code) 
WHERE active_call_code IS NOT NULL;

-- Initialize active_call_code from any currently open call_sessions
UPDATE users u
SET active_call_code = cs.call_code
FROM call_sessions cs
WHERE (cs.caller_id = u.id OR cs.callee_id = u.id)
  AND cs.status IN ('requested', 'ringing', 'connected');
