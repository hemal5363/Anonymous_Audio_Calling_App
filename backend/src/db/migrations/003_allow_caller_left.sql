-- ----------------------------------------------------------------------
-- 003_allow_caller_left.sql
-- Allow 'caller_left' and 'cancelled' in call_sessions end_reason constraint
-- ----------------------------------------------------------------------

ALTER TABLE call_sessions DROP CONSTRAINT IF EXISTS call_sessions_end_reason_check;

ALTER TABLE call_sessions ADD CONSTRAINT call_sessions_end_reason_check 
    CHECK (end_reason IN (
        'caller_hangup', 'callee_hangup', 'declined', 'ring_timeout', 
        'skipped', 'balance_exhausted', 'network_error', 'system_shutdown',
        'caller_left', 'cancelled'
    ));
