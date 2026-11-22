-- Migration 008: Atomic trigger on call_sessions
-- Enforces that neither caller nor callee can ever be in two active calls simultaneously

CREATE OR REPLACE FUNCTION check_no_duplicate_active_calls()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('requested', 'ringing', 'connected') THEN
    -- Row-lock both users in users table to prevent concurrent race conditions
    IF NEW.caller_id IS NOT NULL AND NEW.callee_id IS NOT NULL THEN
      PERFORM 1 FROM users WHERE id IN (NEW.caller_id, NEW.callee_id) FOR UPDATE;
    END IF;
    
    IF EXISTS (
      SELECT 1 FROM call_sessions
      WHERE id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND status IN ('requested', 'ringing', 'connected')
        AND (caller_id IN (NEW.caller_id, NEW.callee_id) OR callee_id IN (NEW.caller_id, NEW.callee_id))
    ) THEN
      RAISE EXCEPTION 'User is already in an active call' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_active_call_participant ON call_sessions;

CREATE TRIGGER trg_check_active_call_participant
BEFORE INSERT OR UPDATE ON call_sessions
FOR EACH ROW
EXECUTE FUNCTION check_no_duplicate_active_calls();
