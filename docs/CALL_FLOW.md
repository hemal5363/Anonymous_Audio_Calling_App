# Call Flow & Signaling Specification

**Target:** Anonymous Audio Calling App (MVP)  
**Document:** `docs/CALL_FLOW.md`  
**Related Specs:** `docs/DB_SCHEMA.md`, `docs/API_SPEC.md`, `docs/SDLC.md`  

---

## 1. Architectural Principles

1. **Strict Anonymity:** Neither peer ever receives the database `user_id`, username, email, phone number, or network IP address of the other party. Every interaction is isolated behind an ephemeral UUIDv4 `call_code`.
2. **Relay-Only Media (IP Masking):** All WebRTC audio streams pass through a private coturn TURN relay with `iceTransportPolicy: 'relay'`, ensuring no direct peer-to-peer UDP/TCP packets are exchanged and client IP addresses remain completely hidden.
3. **Server-Authoritative State & Billing:** The backend alone controls matching eligibility, ringing timeouts, WebRTC room state, call duration timers, and financial ledger deductions.
4. **Push Wake-Up for Closed Apps:** A user whose `is_available` switch is `ON` can receive calls even when their app is in the background or killed, triggered by high-priority Firebase Cloud Messaging (FCM) data messages.
5. **Zero Call Audio Recording:** Call media flows exclusively through the TURN relay memory buffers. No media server, recording pipeline, or persistent audio storage exists.

---

## 2. End-to-End Call Lifecycle Diagram

```
 Caller Phone                       Backend Server (NestJS)                   Callee Phone
 (React Native)                      + PostgreSQL + coturn                   (React Native)
      |                                       |                                    |
      |=========== 1. INITIATION ============|                                    |
      |                                       |                                    |
      |-- [WSS] call:request ---------------->| (1. Check billing & rate limits)   |
      |                                       | (2. Atomic match candidate search) |
      |                                       | (3. Lock candidate record)         |
      |                                       |                                    |
      |=========== 2. ALERT & RINGING =======|                                    |
      |                                       |                                    |
      |<-- [WSS] call:ringing ----------------|                                    |
      |                                       |-- [WSS] call:incoming (if open) -->|
      |                                       |-- [FCM] High-priority push ------->| (Wake up app)
      |                                       |                                    | (Show full-screen alert)
      |                                       |                                    |
      |=========== 3. ACCEPT / DECLINE ======|                                    |
      |                                       |                                    |
      |                                       |<-- [WSS] call:accept --------------|
      |<-- [WSS] call:matched {TURN, code} ---|--- [WSS] call:matched {TURN, code}>|
      |                                       |                                    |
      |=========== 4. WEBRTC SIGNALING ======|                                    |
      |                                       |                                    |
      |-- [WSS] signal:offer ---------------->|-- [WSS] signal:offer ------------->|
      |                                       |<-- [WSS] signal:answer ------------|
      |<-- [WSS] signal:answer ---------------|                                    |
      |-- [WSS] signal:ice ------------------>|-- [WSS] signal:ice --------------->|
      |<-- [WSS] signal:ice ------------------|<-- [WSS] signal:ice ---------------|
      |                                       |                                    |
      |=========== 5. RELAY AUDIO & BILLING =|                                    |
      |                                       |                                    |
      |<====== WebRTC Audio via coturn Relay (Encrypted SRTP, IP Hidden) =========>|
      |                                       |                                    |
      |-- [WSS] call:connected -------------->| (Start billing & duration timer)   |
      |                                       |                                    |
      |                                       |-- [WSS] billing:warning (if 1m left)|
      |                                       |-- [WSS] billing:balance (periodic)->|
      |                                       |                                    |
      |=========== 6. TERMINATION ===========|                                    |
      |                                       |                                    |
      |-- [WSS] call:end {caller_hangup} ---->| (1. Stop timer, finalize ledger)   |
      |                                       | (2. Unlock users, update status)   |
      |<-- [WSS] call:ended ------------------|--- [WSS] call:ended -------------->|
      |                                       |                                    |
      |=========== 7. POST-CALL SAFETY ======|                                    |
      |                                       |                                    |
      |-- [REST] POST /user/blocks ---------->| (Bidirectional block inserted)     |
      |-- [REST] POST /user/reports --------->| (Abuse report filed against peer)  |
      v                                       v                                    v
```

---

## 3. Matching Algorithm & Concurrency Control

### 3.1 Eligibility Criteria
When a caller taps **Call**, the server validates the caller's account and billing standing, then executes candidate selection. An eligible callee must satisfy all of the following rules:
1. `users.id <> caller_id`
2. `users.status = 'active'` (not suspended, banned, or marked for deletion)
3. `users.is_available = TRUE`
4. Not currently participating in an active call (`call_sessions.status NOT IN ('requested', 'ringing', 'connected')`).
5. Neither caller has blocked the candidate, nor has the candidate blocked the caller (checked against `blocks` table).
6. Not matched with the caller within the same-peer rematch cooldown window (`cooldown_same_peer_seconds` in `app_settings`, integer 0 to 86400, default: 60 seconds; 0 disables the restriction and allows immediate rematch). Block and report exclusions are never bypassed even if cooldown is 0.

### 3.2 Two-Tier Priority (Live Socket vs Push)
To minimize call connection latency:
- **Tier 1 (Fast Path):** Users currently connected to the Socket.IO cluster with an active presence heartbeat are tried first. Ring response is immediate.
- **Tier 2 (Push Fallback):** If no live socket candidate is found, users who have `is_available = TRUE` and a non-null `push_token` are targeted via FCM high-priority push.

### 3.3 Atomic Concurrency & Race Condition Prevention
To prevent two callers from claiming the same callee simultaneously (or two users matching each other twice), PostgreSQL transaction-level locking is used via `SELECT ... FOR UPDATE SKIP LOCKED`.

#### Candidate Claim Query
```sql
BEGIN;

-- Atomically locate and lock exactly one eligible callee
WITH eligible_candidate AS (
    SELECT u.id, u.push_token
    FROM users u
    WHERE u.status = 'active'
      AND u.is_available = TRUE
      AND u.id <> :caller_id
      -- Exclude busy users
      AND NOT EXISTS (
          SELECT 1 FROM call_sessions cs
          WHERE (cs.caller_id = u.id OR cs.callee_id = u.id)
            AND cs.status IN ('requested', 'ringing', 'connected')
      )
      -- Exclude blocks in either direction
      AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = :caller_id AND b.blocked_id = u.id)
             OR (b.blocker_id = u.id AND b.blocked_id = :caller_id)
      )
      -- Cooldown: avoid rematching with same user in past cooldown window (if enabled)
      AND (
          :cooldown_seconds <= 0
          OR NOT EXISTS (
              SELECT 1 FROM call_sessions cs_recent
              WHERE ((cs_recent.caller_id = :caller_id AND cs_recent.callee_id = u.id)
                  OR (cs_recent.caller_id = u.id AND cs_recent.callee_id = :caller_id))
                AND cs_recent.created_at > (NOW() - (:cooldown_seconds * INTERVAL '1 second'))
          )
      )
    ORDER BY 
      -- Prioritize users with live socket connection (passed as parameter array)
      CASE WHEN u.id = ANY(:live_socket_user_ids) THEN 0 ELSE 1 END,
      RANDOM()
    LIMIT 1
    FOR UPDATE OF u SKIP LOCKED
)
INSERT INTO call_sessions (
    call_code,
    caller_id,
    callee_id,
    status,
    billing_mode,
    requested_at
)
SELECT 
    gen_random_uuid()::text,
    :caller_id,
    ec.id,
    'ringing',
    :active_billing_mode,
    NOW()
FROM eligible_candidate ec
RETURNING id, call_code, callee_id;

COMMIT;
```

#### Why `FOR UPDATE SKIP LOCKED`?
- **No Blocking / Contention:** Multiple concurrent callers querying simultaneously will never wait on locks. If Candidate X is locked by Caller 1, Caller 2 automatically skips X and locks Candidate Y.
- **Atomic Claim:** The callee is claimed and assigned to a `call_sessions` row within the same atomic transaction.

---

## 4. Offline & Closed-App Handling (Push Wake-Up)

When the chosen callee has no active WebSocket socket, the server wakes the device using Firebase Cloud Messaging (FCM).

### 4.1 Push Payload Format
Push notifications sent for incoming calls use FCM **High-Priority Data Messages** (never display notification messages). This ensures the app's background service boots immediately without showing a generic notification bubble:

```json
{
  "message": {
    "token": "callee_fcm_token_here",
    "android": {
      "priority": "high",
      "ttl": "30s"
    },
    "data": {
      "type": "incoming_call",
      "callCode": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
      "ringSeconds": "30"
    }
  }
}
```

### 4.2 Callee Device Lifecycle
1. **Wake-Up & Full-Screen Alert:** The Android app receives the broadcast receiver intent, launches an elevated full-screen incoming call UI (`showWhenLocked` + `turnScreenOn`), and plays the ringtone.
2. **Socket Handshake:** While ringing, the app connects to Socket.IO (`presence:hello`).
3. **Accept / Decline:**
   - **Accept:** App emits `call:accept { callCode }`. Server cancels the ring timer and initiates WebRTC negotiation.
   - **Decline:** App emits `call:decline { callCode }`. Server marks this attempt failed and selects the next eligible candidate.

### 4.3 Ring Timeout & Retry Mechanism
- The server initializes an in-memory timer (default: `30 seconds`) per attempt.
- If the callee does not answer within 30 seconds:
  1. The server flags the attempt as `ring_timeout`.
  2. If the user failed to wake via push repeatedly, their device is temporarily tagged `unreachable` in memory for 15 minutes.
  3. The server automatically selects another eligible candidate.
  4. Up to **3 match attempts** are executed in sequence. If all 3 candidates fail to accept or time out, the server emits `call:none-available` to the caller.

---

## 5. WebRTC Signaling Protocol & Socket.IO State Machine

Once a call is accepted, the server creates an isolated Socket.IO room named `call:<call_code>` containing only the caller and callee sockets.

```
Caller Socket                      Backend Server                    Callee Socket
     |                                   |                                 |
     |<===== (Both peers receive call:matched with ephemeral TURN) =======>|
     |                                   |                                 |
     | [1. Create PeerConnection]        |   [1. Create PeerConnection]    |
     | [2. Create & Set Local Offer]     |                                 |
     |                                   |                                 |
     |-- signal:offer ------------------>|                                 |
     |   { callCode, sdp }               |-- signal:offer ---------------->|
     |                                   |   { callCode, sdp }             |
     |                                   |                                 |
     |                                   |   [2. Set Remote Offer]         |
     |                                   |   [3. Create & Set Local Answer]|
     |                                   |<-- signal:answer ---------------|
     |<-- signal:answer -----------------|    { callCode, sdp }            |
     |    { callCode, sdp }              |                                 |
     | [3. Set Remote Answer]            |                                 |
     |                                   |                                 |
     |<=========== (Exchange Trickle ICE Candidates via Server) ==========>|
     |-- signal:ice { callCode, candidate } >|-- signal:ice -------------->|
     |<-- signal:ice --------------------|<-- signal:ice ------------------|
     |                                   |                                 |
     | [4. WebRTC state -> 'connected']  |                                 |
     |-- call:connected { callCode } --->| (Start duration & billing timer)|
```

### 5.1 Signaling Relays
All signal messages (`signal:offer`, `signal:answer`, `signal:ice`) are relayed exclusively to the room peer by the backend server. The server inspects the `callCode` to ensure both participants are authorized members of that session.

---

## 6. TURN Relay Architecture & IP Masking

### 6.1 The Risk: WebRTC Direct P2P Leak
Standard WebRTC attempts a direct P2P connection via STUN. If successful, both devices learn each other's public IP address in the ICE candidate exchange. This would compromise anonymity (revealing city, ISP, and approximate location).

### 6.2 The Solution: Relay-Only Media
The app configures `RTCPeerConnection` with:
```javascript
const peerConnectionConfig = {
  iceServers: turnServers,
  iceTransportPolicy: 'relay' // CRITICAL: Drops direct host and srflx candidates
};
```
- When `iceTransportPolicy: 'relay'` is set, the WebRTC engine discards local network interfaces and public IP reflective candidates.
- Only **TURN relay candidates** (`typ relay`) are gathered and sent.
- **Result:** Both phones only see the IP address of the AWS EC2 TURN server. Neither caller nor callee can discover the other's IP address.

### 6.3 Ephemeral Coturn Authentication
Coturn uses the standard **Time-Limited Long-Term Credential Mechanism** (`lt-cred-mech`):
1. Expiry timestamp: `timestamp = Math.floor(Date.now() / 1000) + 86400`
2. Username: `"${timestamp}:${userId}"`
3. Credential: `HMAC-SHA1(coturn_shared_secret, username)`
4. Credentials expire automatically, preventing unauthorized relay bandwidth theft.

---

## 7. In-Call Controls & Post-Call Safety

### 7.1 Mute & Speaker
- **Behavior:** Operates strictly on the local client device via the React Native WebRTC media tracks:
  - **Mute:** `audioTrack.enabled = false` (silences audio stream without interrupting WebRTC session).
  - **Speaker:** Toggles audio output route between earpiece and speakerphone using audio device management APIs.
- **Signaling:** No server messages or state changes are triggered.

### 7.2 End Call
1. Either user taps **End**.
2. Client emits `call:end { callCode, reason: "caller_hangup" }`.
3. Server halts duration timers, finalizes billing ledger rows, updates `call_sessions.status = 'ended'`, and broadcasts `call:ended` to both sockets.
4. Both devices terminate peer connection and transition to the post-call feedback/safety screen.

### 7.2.1 Cancel While Ringing (`caller_left`)
1. Caller taps **Cancel** on the Searching screen while ringing or the caller's socket disconnects before the callee answers.
2. Client emits `call:cancel` or `call:end { callCode, reason: "caller_left" }`.
3. Server cancels the 30-second ringing timeout timer, ends the session immediately with `end_reason = 'caller_left'` (`duration_seconds = 0`), releases both users, and alerts the callee with `call:ended { reason: "caller_left" }`.

### 7.3 Skip Action (Instant Rematch)
1. Caller taps **Skip**.
2. Client sends `call:end { callCode, reason: "skipped" }`.
3. Server closes current call immediately, notifies callee with `call:ended { reason: "skipped" }`.
4. Server immediately treats this as a fresh `call:request` for the caller without returning to the home screen.

### 7.4 Block & Report (Post-Call Screen)
- **Block (`POST /user/blocks`):**
  - Sends `{ call_code }`.
  - Backend resolves `blocked_id` from the session record and inserts `(blocker_id, blocked_id)` into `blocks`.
  - The blocked peer is never notified. Future matching queries exclude both users mutually.
- **Report (`POST /user/reports`):**
  - Sends `{ call_code, reason, note }`.
  - Creates a `reports` row against the opposite participant.
  - **Auto-Moderation (Report-Based Flagging):** If a user receives reports from several different users (threshold configured in `app_settings` under key `'moderation'`, default: 3 distinct reporters), the server automatically marks them as `is_flagged = TRUE` for administrator investigation. The server does **NOT** auto-ban or auto-suspend the account, preserving due process for human admin review.

### 7.5 Abuse Protection & Session Management

#### 7.5.1 Single Active Calling Session (Device Takeover)
- A user can only maintain **one** active socket session for calling at any given time.
- **Takeover Policy (Safer Design Choice):** When a user logs in or connects on a second device while already connected:
  1. The new connection supersedes the previous socket session.
  2. The server emits an `auth:superseded` event to the older socket (`{ message: "Signed in from another device. This session has been disconnected." }`).
  3. Any ongoing call session on the older device is cleanly ended with `reason: 'superseded'`, notifying the other peer with `call:ended`.
  4. The older socket is forcibly disconnected.
  *Rationale:* Rejecting the new connection can permanently lock users out if their prior device crashed, lost network connectivity, or abruptly terminated before TCP teardown. Takeover clears zombie connections cleanly and guarantees users always reach the platform on their current device.

#### 7.5.2 Skip & Cancel Cooldown (Anti-Ringing Spam)
- Rapidly cycling through calls via `call:skip` or cancelling calls during ringing spams prospective callees with unwanted rings.
- The server tracks skip and cancel events within a sliding window (`SOCKET_SKIP_CANCEL_WINDOW_MS`, default: 60s).
- If the event count reaches `SOCKET_SKIP_CANCEL_THRESHOLD` (default: 5), the caller is placed on cooldown for `SOCKET_SKIP_CANCEL_COOLDOWN_MS` (default: 30s).
- During cooldown, any call search request (`call:find` or `call:request`) is rejected with `call:error` (`error: 'cooldown_active'`, including `retryAfterSeconds`).

#### 7.5.3 Real-Time Signaling Rate Limits & Malformed Event Policy
- **Rate Limits:** Per-user sliding-window limits are enforced on `call:find` (default: 10/min), `call:accept` / `call:decline` (default: 15/min), and WebRTC signaling messages (`webrtc:offer`, `webrtc:answer`, `webrtc:ice-candidate`, default: 60/min). Exceeding limits returns `call:error` (`error: 'rate_limit_exceeded'`).
- **Payload Size Cap:** Payloads exceeding `SOCKET_MAX_PAYLOAD_BYTES` (default: 64 KB) are rejected with `call:error` (`error: 'payload_too_large'`).
- **Malformed Event Policy:** Non-object, missing-callCode, or oversized payloads increment a per-socket violation counter. Upon exceeding `SOCKET_MAX_MALFORMED_EVENTS` (default: 5), the offending socket is immediately dropped.

---

## 8. Billing Engine & Tier Enforcement

Billing checks are enforced before match initiation and continuously during call progress. **The callee is never charged.**

```
+---------------------------------------------------------------------------------------------+
|                                    BILLING CHECK MATRIX                                     |
+-------------------+-------------------------------+-----------------------------------------+
| Mode              | Pre-Call Check                | In-Call Enforcement                     |
+-------------------+-------------------------------+-----------------------------------------+
| Free              | None (or check daily cap)     | Ends call if daily free cap is exceeded |
| Subscription      | Active plan required          | Ends call if daily plan cap is exceeded |
| Per-Minute        | Balance >= 1 minute rate      | Increments billing minute at MM:00.     |
|                   |                               | Emits billing:warning at 1 min left.    |
|                   |                               | Auto-hangup at 0 balance.               |
+-------------------+-------------------------------+-----------------------------------------+
```

### 8.1 Mode 1: Free
- **Pre-Call:** Verifies optional platform daily minute limit (`free_daily_minute_cap`).
- **In-Call:** If limit is reached, server sends `call:ended { reason: "balance_exhausted" }`.

### 8.2 Mode 2: Subscription
- **Pre-Call:** Queries `subscriptions` table for an active row where `ends_at > NOW()`. If absent, rejects `call:request` with error `subscription_required`.
- **In-Call:** Enforces daily minute cap (if configured on the plan).

### 8.3 Mode 3: Per-Minute
1. **Pre-Call Authorization:**
   - Server checks `wallets.free_trial_minutes` first.
   - If zero, checks `wallets.balance_amount >= per_minute_rate` (or `balance_minutes >= 1`).
   - If insufficient, rejects `call:request` with error `insufficient_balance`.
2. **In-Call Metering (Server-Side Interval):**
   - Duration timer begins when `call:connected` is received.
   - For every started 60-second window:
     - Deduct 1 minute from trial minutes, or debit `per_minute_rate` from wallet ledger (`wallet_transactions`).
     - Emits updated `billing:balance` to caller.
3. **Low-Balance Warning & Termination:**
   - When remaining balance equals 1 minute: emit `billing:warning`.
   - When balance reaches 0: server forcibly ends call with `call:ended { reason: "balance_exhausted" }`.

---

## 9. Edge Cases & Fault Tolerance

### 9.1 Both Users Tap Call Simultaneously
- **Scenario:** User A and User B tap Call at the exact same millisecond.
- **Resolution:**
  - Both requests trigger `SELECT ... FOR UPDATE SKIP LOCKED`.
  - Transaction A locks User B first; Transaction B's candidate query skips User B (since User B is now in status `ringing`).
  - Transaction B selects another available candidate C, or receives `none-available`.
  - No race condition or deadlock can occur.

### 9.2 Network Drop / Socket Disconnect & Transports
- **Transports & Connection:**
  - The mobile client connects with `transports: ['polling', 'websocket']` and `tryAllTransports: true`, starting on HTTP long-polling and upgrading immediately to WebSocket.
  - The mobile client applies a **5-second disconnect grace period** before concluding a call if a socket drops mid-session. If the socket reconnects within the 5 seconds, the call remains active.
- **Ringing Phase Disconnect:**
  - If the caller's socket disconnects while the call is ringing, the session ends immediately with `end_reason = 'caller_left'`, clears the 30-second ring timeout, releases both users, and notifies the callee with `call:ended`.
  - If the callee disconnects while ringing, the session is marked as `missed` with `end_reason = 'network_error'` and the caller receives `call:none-available`.
- **Connected Phase Disconnect:**
  - If a participant drops mid-call and the grace period expires, the call ends with `call:ended { reason: "network_error" }` and billing is recorded for actual elapsed seconds.

### 9.3 User Toggles Available Switch OFF Mid-Match
- **Scenario:** Callee switches `is_available` to `false` right as a call is ringing.
- **Resolution:**
  - The `PUT /user/availability` endpoint updates `users.is_available = FALSE`.
  - If an active `ringing` session exists for that user, the server cancels the pending incoming alert and immediately re-routes the caller to the next candidate.

### 9.4 Callee Declines or Ignores Call
- **Scenario:** Callee taps Decline or lets the 30-second ring timer expire.
- **Resolution:**
  - Server marks that candidate attempt as declined/timed out.
  - Caller does not see an interruption; caller's screen remains in the searching state.
  - Server seamlessly initiates matching for Candidate #2.
