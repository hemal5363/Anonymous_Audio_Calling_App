# API Specification

**Target:** Anonymous Audio Calling App (MVP)  
**Protocol:** REST (HTTPS) + WebSocket (Socket.IO over WSS)  
**File Location:** `docs/API_SPEC.md`  
**Base URL:** `https://api.yourdomain.com/v1` (Production) / `http://localhost:3000/v1` (Local)  

---

## 1. General Conventions & Standards

### Headers
- `Content-Type: application/json`
- `Authorization: Bearer <access_token>` (for authenticated endpoints)

### Standard Success Response
JSON payloads are returned directly or wrapped in an object:
```json
{
  "success": true,
  "data": { ... }
}
```

### Standard Error Response Format
All HTTP errors adhere to the following schema:
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Detailed error description or array of validation errors",
  "timestamp": "2026-11-21T12:00:00.000Z",
  "path": "/v1/auth/login"
}
```

### Peer Privacy & Anonymity Guarantee
No user endpoint exposes another user's ID, email, phone number, or IP address. Calls, blocks, and reports reference the ephemeral public `call_code` (UUID v4) generated per session.

---

## 2. Authentication Endpoints (`/auth`)

---

### 2.1 Register User (Email & Password)
Registers a new user account with age and terms confirmation. New accounts start with `is_available: false`.

- **Method:** `POST`
- **Path:** `/auth/register`
- **Auth Required:** None
- **Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "confirm_age_18": true,
  "terms_version": "1.0",
  "privacy_version": "1.0"
}
```
- **Response Body (`201 Created`):**
```json
{
  "user": {
    "id": "e0b1f2e3-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
    "email": "user@example.com",
    "status": "active",
    "is_available": false,
    "created_at": "2026-11-21T12:00:00.000Z"
  },
  "tokens": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "d7a8e9f0..."
  }
}
```
- **Error Codes:**
  - `400 Bad Request`: Validation failure (weak password, invalid email format, age not confirmed).
  - `409 Conflict`: Email already registered.

---

### 2.2 Login User (Email & Password)
Authenticates an existing user via email credentials.

- **Method:** `POST`
- **Path:** `/auth/login`
- **Auth Required:** None
- **Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```
- **Response Body (`200 OK`):**
```json
{
  "user": {
    "id": "e0b1f2e3-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
    "email": "user@example.com",
    "phone": null,
    "status": "active",
    "is_available": false
  },
  "tokens": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "d7a8e9f0..."
  }
}
```
- **Error Codes:**
  - `400 Bad Request`: Missing email or password.
  - `401 Unauthorized`: Invalid credentials.
  - `403 Forbidden`: Account is suspended or banned.

---

### 2.3 Request Mobile OTP
Sends an OTP to the target phone number for login or account creation (active only if `mobile_login_enabled` is set to `true` by Admin in `app_settings`).

- **Method:** `POST`
- **Path:** `/auth/otp/request`
- **Auth Required:** None (Rate-limited)
- **Request Body:**
```json
{
  "phone": "+919876543210"
}
```
- **Response Body (`200 OK`):**
```json
{
  "message": "OTP sent successfully",
  "expires_in_seconds": 300
}
```
- **Error Codes:**
  - `400 Bad Request`: Invalid E.164 phone format.
  - `403 Forbidden`: Mobile login is disabled by platform administrator.
  - `429 Too Many Requests`: Rate limit exceeded for phone number or IP.

---

### 2.4 Verify Mobile OTP
Verifies the OTP code. If the phone is new, an account is automatically created.

- **Method:** `POST`
- **Path:** `/auth/otp/verify`
- **Auth Required:** None
- **Request Body:**
```json
{
  "phone": "+919876543210",
  "otp": "482910"
}
```
- **Response Body (`200 OK`):**
```json
{
  "user": {
    "id": "f1c2d3e4-5b6a-7c8d-9e0f-1a2b3c4d5e6f",
    "email": null,
    "phone": "+919876543210",
    "status": "active",
    "is_available": false
  },
  "tokens": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "e8b9c0d1..."
  }
}
```
- **Error Codes:**
  - `400 Bad Request`: Missing phone or OTP code.
  - `401 Unauthorized`: Invalid or expired OTP code / Max attempts reached.
  - `403 Forbidden`: Account is suspended or banned.

---

### 2.5 Refresh Access Token
Issues a new JWT access token using a valid rotating refresh token.

- **Method:** `POST`
- **Path:** `/auth/refresh`
- **Auth Required:** None
- **Request Body:**
```json
{
  "refreshToken": "d7a8e9f0..."
}
```
- **Response Body (`200 OK`):**
```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "a1b2c3d4..."
}
```
- **Error Codes:**
  - `400 Bad Request`: Missing refresh token.
  - `401 Unauthorized`: Invalid, expired, or revoked refresh token.

---

### 2.6 Logout
Revokes the current refresh token and clears active device presence.

- **Method:** `POST`
- **Path:** `/auth/logout`
- **Auth Required:** Bearer JWT User
- **Request Body:**
```json
{
  "refreshToken": "a1b2c3d4..."
}
```
- **Response Body (`200 OK`):**
```json
{
  "message": "Logged out successfully"
}
```
- **Error Codes:**
  - `401 Unauthorized`: Invalid or missing access token.

---

## 3. User Endpoints (`/user`)

---

### 3.1 Toggle Availability Switch
Sets whether the user is available to receive anonymous calls. When set to `true`, the user may receive calls whether the app is open, backgrounded, or closed (via push wake-up).

- **Method:** `PUT`
- **Path:** `/user/availability`
- **Auth Required:** Bearer JWT User
- **Request Body:**
```json
{
  "is_available": true
}
```
- **Response Body (`200 OK`):**
```json
{
  "is_available": true,
  "available_changed_at": "2026-11-21T12:05:00.000Z"
}
```
- **Error Codes:**
  - `400 Bad Request`: Missing or non-boolean `is_available`.
  - `401 Unauthorized`: Invalid credentials.
  - `403 Forbidden`: User account is banned/suspended or push token missing when turning on.

---

### 3.2 Register / Update Push Token
Saves the Firebase Cloud Messaging (FCM) device push token used to wake the phone for incoming calls when closed or backgrounded.

- **Method:** `POST`
- **Path:** `/user/push-token`
- **Auth Required:** Bearer JWT User
- **Request Body:**
```json
{
  "push_token": "fcm_token_string_example_123456789"
}
```
- **Response Body (`200 OK`):**
```json
{
  "message": "Push token registered successfully"
}
```
- **Error Codes:**
  - `400 Bad Request`: Empty or invalid token string.
  - `401 Unauthorized`: Missing or invalid auth header.

---

### 3.3 Block User (by Call Code)
Blocks the peer from the last or specific call. Neither user will ever be matched again. The blocked peer is never alerted.

- **Method:** `POST`
- **Path:** `/user/blocks`
- **Auth Required:** Bearer JWT User
- **Request Body:**
```json
{
  "call_code": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c"
}
```
- **Response Body (`201 Created`):**
```json
{
  "message": "User blocked successfully"
}
```
- **Error Codes:**
  - `400 Bad Request`: Invalid `call_code` format.
  - `401 Unauthorized`: Missing or invalid token.
  - `404 Not Found`: Call session not found or user was not a participant.
  - `409 Conflict`: User is already blocked.

---

### 3.4 Report Call / User
Files an abuse report for a call session. The server links the report to the opposite participant automatically.

- **Method:** `POST`
- **Path:** `/user/reports`
- **Auth Required:** Bearer JWT User
- **Request Body:**
```json
{
  "call_code": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
  "reason": "harassment",
  "note": "Caller was using abusive language repeatedly."
}
```
*Allowed `reason` values:* `'harassment'`, `'abusive_language'`, `'sexual_content'`, `'scam'`, `'underage'`, `'spam'`, `'other'`.

- **Response Body (`201 Created`):**
```json
{
  "report_id": "9b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e",
  "status": "pending",
  "message": "Report submitted successfully"
}
```
- **Error Codes:**
  - `400 Bad Request`: Invalid reason category or missing `call_code`.
  - `401 Unauthorized`: Missing or invalid token.
  - `404 Not Found`: Call session not found or user was not a participant.
  - `409 Conflict`: A report for this call has already been filed by this user.

---

## 4. Calls Endpoints (`/calls`)

---

### 4.1 Get Call History
Retrieves user call history with full anonymity preserved. Only public `call_code`, timestamps, durations, and costs are exposed. Other users' identifiers are never included.

- **Method:** `GET`
- **Path:** `/calls/history?limit=20&page=1`
- **Auth Required:** Bearer JWT User
- **Query Parameters:**
  - `limit` (optional, default `20`, max `50`)
  - `page` (optional, default `1`)
- **Request Body:** None
- **Response Body (`200 OK`):**
```json
{
  "calls": [
    {
      "call_code": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
      "role": "caller",
      "status": "ended",
      "duration_seconds": 185,
      "requested_at": "2026-11-21T11:45:00.000Z",
      "ended_at": "2026-11-21T11:48:05.000Z",
      "end_reason": "caller_hangup",
      "amount_charged": "3.00",
      "billing_mode": "per_minute"
    },
    {
      "call_code": "d8b2e3c5-6a7e-8f9b-0c1d-2e3f4a5b6c7d",
      "role": "callee",
      "status": "ended",
      "duration_seconds": 64,
      "requested_at": "2026-11-21T10:15:00.000Z",
      "ended_at": "2026-11-21T10:16:04.000Z",
      "end_reason": "callee_hangup",
      "amount_charged": "0.00",
      "billing_mode": "per_minute"
    }
  ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```
- **Error Codes:**
  - `401 Unauthorized`: Missing or invalid token.

---

### 4.2 Get TURN Credentials
Generates short-lived HMAC time-limited coturn server credentials for WebRTC peer connection relay.

- **Method:** `GET`
- **Path:** `/calls/turn-credentials`
- **Auth Required:** Bearer JWT User
- **Request Body:** None
- **Response Body (`200 OK`):**
```json
{
  "iceServers": [
    {
      "urls": [
        "stun:stun.yourdomain.com:3478"
      ]
    },
    {
      "urls": [
        "turn:turn.yourdomain.com:3478?transport=udp",
        "turn:turn.yourdomain.com:3478?transport=tcp"
      ],
      "username": "1732190400:e0b1f2e3-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
      "credential": "computed_hmac_secret_token"
    }
  ],
  "ttl": 86400
}
```
- **Error Codes:**
  - `401 Unauthorized`: Missing or invalid token.

---

## 5. Billing Endpoints (`/billing`)

---

### 5.1 Get Wallet Balance & Details
Retrieves user wallet balance in both currency units, available minutes, and remaining free trial minutes.

- **Method:** `GET`
- **Path:** `/billing/wallet`
- **Auth Required:** Bearer JWT User
- **Request Body:** None
- **Response Body (`200 OK`):**
```json
{
  "wallet": {
    "balance_amount": "50.00",
    "balance_minutes": 50,
    "free_trial_minutes": 10,
    "is_locked": false,
    "currency": "INR"
  },
  "current_mode": "per_minute",
  "rate_per_minute": "1.00"
}
```
- **Error Codes:**
  - `401 Unauthorized`: Missing or invalid token.

---

### 5.2 Wallet Top-Up
Simulates or processes a wallet balance credit (MVP direct credit / payment webhook mock).

- **Method:** `POST`
- **Path:** `/billing/wallet/topup`
- **Auth Required:** Bearer JWT User
- **Request Body:**
```json
{
  "amount": 50.00,
  "currency": "INR",
  "payment_reference": "TXN_MOCK_987654321"
}
```
- **Response Body (`200 OK`):**
```json
{
  "success": true,
  "transaction_id": "3a4b5c6d-7e8f-9a0b-1c2d-3e4f5a6b7c8d",
  "new_balance": "100.00",
  "balance_minutes": 100
}
```
- **Error Codes:**
  - `400 Bad Request`: Invalid amount (amount must be >= 1.00).
  - `401 Unauthorized`: Missing or invalid token.
  - `403 Forbidden`: Wallet is locked.

---

### 5.3 Get Subscription Status & Available Plans
Retrieves the active user subscription (if any) and lists all active plans available for subscription.

- **Method:** `GET`
- **Path:** `/billing/subscription`
- **Auth Required:** Bearer JWT User
- **Request Body:** None
- **Response Body (`200 OK`):**
```json
{
  "active_subscription": {
    "id": "1e2f3a4b-5c6d-7e8f-9a0b-1c2d3e4f5a6b",
    "plan_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "plan_name": "Unlimited Monthly",
    "status": "active",
    "starts_at": "2026-11-01T00:00:00.000Z",
    "ends_at": "2026-12-01T00:00:00.000Z",
    "daily_minute_cap": null,
    "minutes_used_today": 45
  },
  "available_plans": [
    {
      "id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "name": "Unlimited Monthly",
      "description": "Unlimited calls for 30 days",
      "price": "99.00",
      "currency": "INR",
      "duration_days": 30,
      "daily_minute_cap": null
    }
  ]
}
```
- **Error Codes:**
  - `401 Unauthorized`: Missing or invalid token.

---

## 6. Admin Endpoints (`/admin`)

---

### 6.1 Admin Login
Authenticates an administrator with email, password, and optional TOTP MFA code.

- **Method:** `POST`
- **Path:** `/admin/auth/login`
- **Auth Required:** None
- **Request Body:**
```json
{
  "email": "admin@yourdomain.com",
  "password": "SuperAdminPassword123!",
  "totp_code": "123456"
}
```
- **Response Body (`200 OK`):**
```json
{
  "admin": {
    "id": "d1c2b3a4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    "email": "admin@yourdomain.com",
    "role": "superadmin"
  },
  "token": "eyJhbGciOi..."
}
```
- **Error Codes:**
  - `400 Bad Request`: Missing credentials.
  - `401 Unauthorized`: Invalid credentials or invalid TOTP code.

---

### 6.2 Get & Update App Settings
Reads and modifies global system configuration, including monetization mode, mobile login toggle, calling thresholds, and rate rules.

#### A. Get Settings
- **Method:** `GET`
- **Path:** `/admin/settings`
- **Auth Required:** Bearer JWT Admin
- **Request Body:** None
- **Response Body (`200 OK`):**
```json
{
  "monetization": {
    "mode": "free",
    "per_minute_rate": 1.00,
    "currency": "INR",
    "free_trial_minutes_new_user": 10,
    "free_daily_minute_cap": 30
  },
  "auth_settings": {
    "email_login_enabled": true,
    "mobile_login_enabled": false,
    "otp_expiry_seconds": 300,
    "max_otp_attempts": 3
  },
  "matching_settings": {
    "ring_timeout_seconds": 30,
    "max_match_attempts": 3,
    "cooldown_same_peer_seconds": 1800,
    "try_live_presence_first": true
  },
  "moderation_settings": {
    "auto_suspend_report_threshold": 3,
    "auto_suspend_window_hours": 24,
    "suspension_duration_hours": 48
  }
}
```

#### B. Update Setting
- **Method:** `PUT`
- **Path:** `/admin/settings/:key`
- **Auth Required:** Bearer JWT Admin (`superadmin` or `admin`)
- **URL Param:** `key` (`monetization`, `auth_settings`, `matching_settings`, `moderation_settings`)
- **Request Body:**
```json
{
  "value_json": {
    "mode": "per_minute",
    "per_minute_rate": 1.50,
    "currency": "INR",
    "free_trial_minutes_new_user": 5,
    "free_daily_minute_cap": 15
  }
}
```
- **Response Body (`200 OK`):**
```json
{
  "message": "Setting updated successfully",
  "key": "monetization"
}
```
- **Error Codes:**
  - `400 Bad Request`: Invalid setting payload structure.
  - `401 Unauthorized`: Invalid admin token.
  - `403 Forbidden`: Insufficient role permissions.
  - `404 Not Found`: Setting key does not exist.

---

### 6.3 Manage Users (List, Search & Status Update)

#### A. List & Search Users
- **Method:** `GET`
- **Path:** `/admin/users?search=user@example.com&status=active&limit=20&page=1`
- **Auth Required:** Bearer JWT Admin
- **Response Body (`200 OK`):**
```json
{
  "users": [
    {
      "id": "e0b1f2e3-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
      "email": "user@example.com",
      "phone": null,
      "status": "active",
      "is_available": true,
      "wallet_balance": "50.00",
      "reports_count": 0,
      "created_at": "2026-11-21T10:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

#### B. Update User Status (Suspend, Ban, Unban)
- **Method:** `PATCH`
- **Path:** `/admin/users/:id/status`
- **Auth Required:** Bearer JWT Admin
- **Request Body:**
```json
{
  "status": "suspended",
  "reason": "Excessive harassment reports received"
}
```
*Allowed `status` values:* `'active'`, `'suspended'`, `'banned'`.
- **Response Body (`200 OK`):**
```json
{
  "message": "User status updated to suspended",
  "user_id": "e0b1f2e3-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
  "status": "suspended"
}
```
- **Error Codes:**
  - `400 Bad Request`: Invalid status value.
  - `401 Unauthorized`: Invalid admin token.
  - `404 Not Found`: User not found.

---

### 6.4 Manage Reports Queue

#### A. List Reports
- **Method:** `GET`
- **Path:** `/admin/reports?status=pending&limit=20&page=1`
- **Auth Required:** Bearer JWT Admin
- **Response Body (`200 OK`):**
```json
{
  "reports": [
    {
      "id": "9b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e",
      "call_code": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
      "reporter_id": "e0b1f2e3-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
      "reported_id": "f1c2d3e4-5b6a-7c8d-9e0f-1a2b3c4d5e6f",
      "reason": "harassment",
      "note": "Caller was using abusive language repeatedly.",
      "status": "pending",
      "created_at": "2026-11-21T11:50:00.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

#### B. Resolve Report
- **Method:** `PATCH`
- **Path:** `/admin/reports/:id`
- **Auth Required:** Bearer JWT Admin
- **Request Body:**
```json
{
  "status": "resolved",
  "action_taken": "suspension",
  "note": "User received 3rd strike, suspended for 48 hours."
}
```
*Allowed `action_taken`:* `'none'`, `'warning'`, `'suspension'`, `'ban'`.
- **Response Body (`200 OK`):**
```json
{
  "message": "Report resolved successfully"
}
```
- **Error Codes:**
  - `400 Bad Request`: Invalid action or status.
  - `401 Unauthorized`: Invalid admin token.
  - `404 Not Found`: Report not found.

---

### 6.5 Admin Dashboard Statistics
Provides aggregated real-time and historical platform metrics.

- **Method:** `GET`
- **Path:** `/admin/stats`
- **Auth Required:** Bearer JWT Admin
- **Request Body:** None
- **Response Body (`200 OK`):**
```json
{
  "overview": {
    "total_registered_users": 1250,
    "active_users_today": 320,
    "currently_online_sockets": 48,
    "currently_available_users": 26,
    "active_calls_now": 4
  },
  "today_metrics": {
    "total_calls_initiated": 215,
    "total_connected_calls": 182,
    "total_call_minutes": 546,
    "total_revenue": "480.00"
  },
  "safety_metrics": {
    "pending_reports_count": 3,
    "banned_users_count": 8
  }
}
```
- **Error Codes:**
  - `401 Unauthorized`: Invalid admin token.

---

## 7. Socket.IO Real-Time Events (WSS)

Socket.IO connection URL: `wss://api.yourdomain.com/socket.io/?token=<access_token>`  
All client-emitted events require an authenticated socket connection.

```
+-----------------------------------------------------------------------------------------+
|                               CALL LIFECYCLE EVENT FLOW                                 |
+-----------------------------------------------------------------------------------------+

  Caller Client                          Backend Server                       Callee Client
       |                                       |                                    |
       |--- presence:hello ------------------->|                                    |
       |                                       |<--- presence:hello ----------------|
       |                                       |                                    |
       |--- call:request --------------------->| (Find available match)             |
       |                                       |--- call:incoming ----------------->| (or FCM Push)
       |                                       |                                    |
       |                                       |<--- call:accept -------------------|
       |<-- call:matched (w/ TURN) ------------|--- call:matched (w/ TURN) -------->|
       |                                       |                                    |
       |--- signal:offer --------------------->|--- signal:offer ------------------>|
       |<-- signal:answer ---------------------|<-- signal:answer ------------------|
       |<-- signal:ice ----------------------->|<-- signal:ice -------------------->|
       |                                       |                                    |
       |=== (P2P Encrypted Audio Stream via coturn TURN Relay) =====================|
       |                                       |                                    |
       |--- call:connected ------------------->| (Server starts timer & billing)    |
       |                                       |                                    |
       |                                       |--- billing:warning --------------->|
       |                                       |--- billing:balance --------------->|
       |                                       |                                    |
       |--- call:end ------------------------->|                                    |
       |<-- call:ended {reason} ---------------|--- call:ended {reason} ----------->|
```

---

### 7.1 Presence & Setup

#### `presence:hello`
- **Direction:** Client $\rightarrow$ Server
- **Payload:** None (Socket is identified by the handshake JWT `auth.token`).
- **Description:** Emitted immediately after socket connection to register the user in the fast in-memory live matching pool.

---

### 7.2 Call Negotiation & Signaling

#### `call:request`
- **Direction:** Client $\rightarrow$ Server
- **Payload:**
```json
{}
```
- **Description:** Caller initiates a call. Server executes billing pre-check and triggers matching algorithm.

---

#### `call:incoming`
- **Direction:** Server $\rightarrow$ Callee Client
- **Payload:**
```json
{
  "callCode": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
  "ringSeconds": 30
}
```
- **Description:** Delivered to candidate with an open app connection. (If closed/backgrounded, FCM high-priority push payload `data: { type: "incoming_call", callCode }` wakes the device).

---

#### `call:accept`
- **Direction:** Callee Client $\rightarrow$ Server
- **Payload:**
```json
{
  "callCode": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c"
}
```
- **Description:** Callee accepts the incoming call.

---

#### `call:decline`
- **Direction:** Callee Client $\rightarrow$ Server
- **Payload:**
```json
{
  "callCode": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
  "reason": "declined"
}
```
- **Description:** Callee declines. Server selects the next candidate without notifying the caller.

---

#### `call:none-available`
- **Direction:** Server $\rightarrow$ Caller Client
- **Payload:**
```json
{
  "message": "No available users at this moment. Please try again shortly."
}
```
- **Description:** Sent to caller if all match attempts fail or time out.

---

#### `call:matched`
- **Direction:** Server $\rightarrow$ Both Clients
- **Payload:**
```json
{
  "callCode": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
  "role": "caller", // or "callee"
  "iceServers": [
    { "urls": "stun:stun.yourdomain.com:3478" },
    {
      "urls": [
        "turn:turn.yourdomain.com:3478?transport=udp",
        "turn:turn.yourdomain.com:3478?transport=tcp"
      ],
      "username": "1732190400:ephemeral_user",
      "credential": "computed_hmac_secret"
    }
  ]
}
```
- **Description:** Sent to both peers with ephemeral TURN credentials to start WebRTC handshake.

---

#### `signal:offer`
- **Direction:** Bidirectional (Caller $\rightarrow$ Server $\rightarrow$ Callee)
- **Payload:**
```json
{
  "callCode": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
  "sdp": {
    "type": "offer",
    "sdp": "v=0\r\no=- 461173... IN IP4 0.0.0.0\r\n..."
  }
}
```
- **Description:** WebRTC session offer relayed transparently through the server.

---

#### `signal:answer`
- **Direction:** Bidirectional (Callee $\rightarrow$ Server $\rightarrow$ Caller)
- **Payload:**
```json
{
  "callCode": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
  "sdp": {
    "type": "answer",
    "sdp": "v=0\r\no=- 461174... IN IP4 0.0.0.0\r\n..."
  }
}
```
- **Description:** WebRTC session answer relayed transparently through the server.

---

#### `signal:ice`
- **Direction:** Bidirectional (Peer A $\rightarrow$ Server $\rightarrow$ Peer B)
- **Payload:**
```json
{
  "callCode": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
  "candidate": {
    "candidate": "candidate:842163049 1 udp 1677729535 192.0.2.1 54321 typ relay ...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```
- **Description:** Trickle ICE candidate relay.

---

### 7.3 In-Call Lifecycle & Billing

#### `call:connected`
- **Direction:** Client $\rightarrow$ Server
- **Payload:**
```json
{
  "callCode": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c"
}
```
- **Description:** Sent by caller when WebRTC `iceConnectionState` becomes `connected`. Starts the backend call duration counter and per-minute billing timers.

---

#### `billing:warning`
- **Direction:** Server $\rightarrow$ Caller Client
- **Payload:**
```json
{
  "callCode": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
  "remainingMinutes": 1,
  "message": "1 minute remaining on your balance."
}
```
- **Description:** Warns caller when only 1 minute of balance or plan daily limit remains.

---

#### `billing:balance`
- **Direction:** Server $\rightarrow$ Caller Client
- **Payload:**
```json
{
  "remainingBalance": "48.00",
  "remainingMinutes": 48
}
```
- **Description:** Periodic or post-deduction real-time balance broadcast.

---

#### `call:end`
- **Direction:** Client $\rightarrow$ Server
- **Payload:**
```json
{
  "callCode": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
  "reason": "caller_hangup" // or "skipped"
}
```
- **Description:** Sent when a user taps "End Call" or "Skip".

---

#### `call:ended`
- **Direction:** Server $\rightarrow$ Both Clients
- **Payload:**
```json
{
  "callCode": "c7a1e2b4-5f6d-7e8a-9b0c-1d2e3f4a5b6c",
  "durationSeconds": 185,
  "reason": "caller_hangup"
}
```
*Possible `reason` values:* `'caller_hangup'`, `'callee_hangup'`, `'skipped'`, `'balance_exhausted'`, `'ring_timeout'`, `'network_error'`.
- **Description:** Closes session, cleans up peer connection, and presents the Report/Block prompt on the client.
