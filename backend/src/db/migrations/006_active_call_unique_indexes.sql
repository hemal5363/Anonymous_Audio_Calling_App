-- Migration 006: Ensure no user is ever in two active calls concurrently
-- Clean up any orphaned stuck sessions where caller or callee is null or older than 1 hour
UPDATE call_sessions
SET status = 'ended', end_reason = 'system_shutdown', ended_at = CURRENT_TIMESTAMP
WHERE status IN ('requested', 'ringing', 'connected')
  AND (caller_id IS NULL OR callee_id IS NULL OR requested_at < (NOW() - INTERVAL '1 hour'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_sessions_active_caller 
ON call_sessions (caller_id) 
WHERE status IN ('requested', 'ringing', 'connected');

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_sessions_active_callee 
ON call_sessions (callee_id) 
WHERE status IN ('requested', 'ringing', 'connected');
