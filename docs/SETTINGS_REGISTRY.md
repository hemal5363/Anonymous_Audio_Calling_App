# Settings Registry & Configuration Architecture

**Document:** `docs/SETTINGS_REGISTRY.md`  
**Status:** Canonical Architecture Specification (Amended)  
**Scope:** `backend/`, `admin/`, `mobile/`  

---

## Executive Summary

This specification establishes the canonical settings registry for the Anonymous Audio Calling platform. It defines the authoritative architecture for configuration management, database migrations, in-memory caching, runtime hot-reloading, security boundaries, and public client exposure.

### Core Architectural Principles

1.  **Code-Defined Registry, Database Overrides:**  
    The backend codebase defines the authoritative registry of all permitted configuration keys, data types, validation constraints (min/max), units, default values, and visibility scopes. The database stores **only administrator overrides**. If a key is absent from the database, the system executes cleanly using its code-defined default. Unknown keys and out-of-range values are strictly rejected.
2.  **Strict Security Classification:**  
    *   **Group A (Dynamic Admin Settings):** Managed via the Admin Panel and stored in `app_settings`.
    *   **Group B (Infrastructure & Cryptographic Secrets):** Pinned exclusively to `.env`. This includes user/admin JWT token lifetimes, admin brute-force lockout rules, STUN/TURN server URLs, and the Coturn HMAC shared secret.
    *   **Group C (Code Constants & Invariants):** Hardcoded in source code. This includes:
        *   `min_registration_age = 18` (Legal & store compliance constant).
        *   `billing_currency = 'INR'` (Fixed currency constant).
        *   `billing_pulse_interval_ms = 60000` (1 minute ticker).
        *   `cleanup_service_interval_ms = 300000` (5 minutes).
        *   `push_notification_receipt_delay_ms = 60000` (1 minute).
        *   `otp_purge_retention_hours = 24` (24 hours).
3.  **Derived Operational Parameters:**  
    `stuck_ringing_cleanup_seconds` is **not a setting**. It is derived directly as:
    $$\text{stuck\_ringing\_cleanup\_seconds} = \text{ring\_timeout\_seconds} + 30$$
4.  **In-Memory Caching & Hot Reloading:**  
    All active settings are served from an in-memory cache in the single-process Node.js runtime (0ms latency, zero DB queries per request). Updates from the Admin Panel invalidate and refresh the cache immediately. If the database is down, the system continues operating seamlessly using cached values or code defaults.
5.  **Snapshotting at Match Time:**  
    When two users match and a `call_sessions` row is created, key session parameters (`snapshot_mode`, `snapshot_rate_per_minute`, `snapshot_ring_timeout`, `snapshot_max_duration`, `snapshot_currency`) are permanently snapshotted into `call_sessions`. In-flight calls never experience mid-call tariff inflation or sudden timeout shifts.
6.  **Administrative Maintenance & Health Exemptions:**  
    When maintenance mode is enabled, new user logins, registrations, and `call:find` matchmaking requests are blocked. However, `/health`, `/api/v1/config/public`, `/admin/*` routes, and admin login (`/admin/auth/login`) are **never blocked**. Active in-flight calls continue to completion.
7.  **Numerical Version Gating:**  
    The mobile client transmits `X-App-Version`. If this is numerically below `min_supported_mobile_version`, the server rejects login, registration, and matchmaking with HTTP 426 / socket error `"update_required"`.

---

## 1. Classification & Boundary Decisions

```
+----------------------------------------------------------------------------------------------------+
|                                    PLATFORM CONFIGURATION TIERS                                    |
+------------------------------+------------------------------+--------------------------------------+
| GROUP A: Admin Panel         | GROUP B: Environment (.env)  | GROUP C: Technical Constants         |
| (Dynamic Runtime Overrides)  | (Host, Secrets & Topology)   | (Invariants, Standards & Hardware)   |
+------------------------------+------------------------------+--------------------------------------+
| * Maintenance switch & text  | * DATABASE_URL               | * min_registration_age = 18          |
| * Mobile version gating      | * JWT_SECRET                 | * billing_currency = 'INR'           |
| * User registration switch   | * JWT_REFRESH_SECRET         | * billing_pulse_interval_ms = 60000  |
| * Login provider switches    | * TURN_SECRET (HMAC root)    | * cleanup_service_interval_ms=300000 |
| * Password length & OTP rules| * TURN_USERNAME / PASSWORD   | * push_receipt_delay_ms = 60000      |
| * Rematch cooldown & matching| * webrtc_stun_urls           | * otp_purge_retention_hours = 24     |
| * Call timeouts & max duration|* webrtc_turn_url             | * derived stuck_ringing_cleanup      |
| * Monetization mode & rates  | * webrtc_turn_credential_ttl | * Audio constraints (audio only)     |
| * Subscription plans catalog | * user_token_ttl (access/ref)| * Coturn HMAC-SHA1 algorithm         |
| * Moderation & abuse caps    | * admin_token_ttl            | * Socket.IO protocol event strings   |
| * User availability grace    | * admin_max_login_attempts   | * Android native manifest permissions|
| * Call history retention     | * admin_lockout_duration     | * Bcrypt work factor (12 rounds)     |
| * Push notification copy     | * HOST / PORT / NODE_ENV     | * Socket payload cap (64 KB)         |
| * Compliance & policy URLs   | * CORS origins / PROXY trust | * Engine.IO ping timeout (20s/25s)   |
| * Rate limit traffic caps    |                              | * Call & report enum database states |
+------------------------------+------------------------------+--------------------------------------+
```

---

## 2. Storage Architecture & Database Schema

### 2.1 Storage Model: One Row Per Key
To eliminate setting collisions and partial overwrites, `app_settings` stores **one row per key**.

### 2.2 Table Schemas

```sql
-- 1. Dynamic Application Settings (Overrides only)
CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(64) PRIMARY KEY,
    value_json JSONB NOT NULL,
    updated_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. Immutable Configuration Audit Log
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

-- 3. Call Session Match-Time Snapshot Columns
ALTER TABLE call_sessions
    ADD COLUMN IF NOT EXISTS snapshot_mode VARCHAR(32),
    ADD COLUMN IF NOT EXISTS snapshot_rate_per_minute NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS snapshot_ring_timeout INTEGER,
    ADD COLUMN IF NOT EXISTS snapshot_max_duration INTEGER,
    ADD COLUMN IF NOT EXISTS snapshot_currency VARCHAR(3) DEFAULT 'INR';
```

### 2.3 Data Migration Plan

The migration unbundles the legacy composite rows (`monetization`, `auth_settings`, `matching_settings`, `moderation`, `moderation_settings`, `retention`) into individual setting rows.

#### Key Principles:
1.  **Preserve Subscription Plans:** Extract existing subscription plans from `monetization.subscription_plans` and insert them into the `subscription_plans` key **before** the `monetization` row is deleted.
2.  **Preserve Existing Values:** If an administrator deliberately configured a custom value, that value is preserved.
3.  **Transaction Safety:** The entire migration runs within a single atomic transaction.

```sql
BEGIN;

-- 1. Create audit table and add snapshot columns
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

ALTER TABLE call_sessions
    ADD COLUMN IF NOT EXISTS snapshot_mode VARCHAR(32),
    ADD COLUMN IF NOT EXISTS snapshot_rate_per_minute NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS snapshot_ring_timeout INTEGER,
    ADD COLUMN IF NOT EXISTS snapshot_max_duration INTEGER,
    ADD COLUMN IF NOT EXISTS snapshot_currency VARCHAR(3) DEFAULT 'INR';

-- 2. Stage unbundled settings
CREATE TEMP TABLE temp_unbundled_settings (
    key VARCHAR(64),
    value_json JSONB,
    updated_by UUID,
    updated_at TIMESTAMP WITH TIME ZONE
) ON COMMIT DROP;

-- Extract subscription_plans BEFORE deleting monetization
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'subscription_plans',
       CASE 
         WHEN value_json ? 'subscription_plans' AND jsonb_typeof(value_json->'subscription_plans') = 'array' AND jsonb_array_length(value_json->'subscription_plans') > 0
         THEN value_json->'subscription_plans'
         ELSE '[{"id": "1", "name": "Starter Pass", "price": 49.00, "duration_days": 30, "active": true}, {"id": "2", "name": "Unlimited Monthly", "price": 99.00, "duration_days": 30, "active": true}]'::jsonb
       END,
       updated_by, updated_at
FROM app_settings WHERE key = 'monetization';

-- If no monetization row existed, supply default subscription_plans
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'subscription_plans',
       '[{"id": "1", "name": "Starter Pass", "price": 49.00, "duration_days": 30, "active": true}, {"id": "2", "name": "Unlimited Monthly", "price": 99.00, "duration_days": 30, "active": true}]'::jsonb,
       NULL, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM temp_unbundled_settings WHERE key = 'subscription_plans');

-- Extract remaining monetization properties
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

-- Extract auth_settings
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'email_login_enabled', to_jsonb(COALESCE((value_json->>'email_login_enabled')::boolean, true)), updated_by, updated_at FROM app_settings WHERE key = 'auth_settings'
UNION ALL
SELECT 'mobile_login_enabled', to_jsonb(COALESCE((value_json->>'mobile_login_enabled')::boolean, false)), updated_by, updated_at FROM app_settings WHERE key = 'auth_settings'
UNION ALL
SELECT 'otp_expiry_seconds', to_jsonb(COALESCE((value_json->>'otp_expiry_seconds')::numeric, 300)), updated_by, updated_at FROM app_settings WHERE key = 'auth_settings'
UNION ALL
SELECT 'otp_max_verify_attempts', to_jsonb(COALESCE((value_json->>'max_otp_attempts')::numeric, 3)), updated_by, updated_at FROM app_settings WHERE key = 'auth_settings';

-- Extract matching_settings
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'ring_timeout_seconds', to_jsonb(COALESCE((value_json->>'ring_timeout_seconds')::numeric, 30)), updated_by, updated_at FROM app_settings WHERE key = 'matching_settings'
UNION ALL
SELECT 'max_match_attempts', to_jsonb(COALESCE((value_json->>'max_match_attempts')::numeric, 3)), updated_by, updated_at FROM app_settings WHERE key = 'matching_settings'
UNION ALL
SELECT 'try_live_presence_first', to_jsonb(COALESCE((value_json->>'try_live_presence_first')::boolean, true)), updated_by, updated_at FROM app_settings WHERE key = 'matching_settings'
UNION ALL
SELECT 'cooldown_same_peer_seconds', to_jsonb(COALESCE((value_json->>'cooldown_same_peer_seconds')::numeric, 60)), updated_by, updated_at FROM app_settings WHERE key = 'matching_settings';

-- Extract moderation and moderation_settings
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'auto_flag_report_threshold', to_jsonb(COALESCE((value_json->>'flag_report_threshold')::numeric, 3)), updated_by, updated_at FROM app_settings WHERE key = 'moderation'
UNION ALL
SELECT 'auto_suspend_report_threshold', to_jsonb(COALESCE((value_json->>'auto_suspend_report_threshold')::numeric, 5)), updated_by, updated_at FROM app_settings WHERE key = 'moderation_settings'
UNION ALL
SELECT 'auto_suspend_window_hours', to_jsonb(COALESCE((value_json->>'auto_suspend_window_hours')::numeric, 24)), updated_by, updated_at FROM app_settings WHERE key = 'moderation_settings'
UNION ALL
SELECT 'auto_suspension_duration_hours', to_jsonb(COALESCE((value_json->>'suspension_duration_hours')::numeric, 48)), updated_by, updated_at FROM app_settings WHERE key = 'moderation_settings';

-- Extract retention
INSERT INTO temp_unbundled_settings (key, value_json, updated_by, updated_at)
SELECT 'call_history_retention_days', to_jsonb(COALESCE((value_json->>'call_history_retention_days')::numeric, 90)), updated_by, updated_at FROM app_settings WHERE key = 'retention'
UNION ALL
SELECT 'availability_grace_period_minutes', to_jsonb(COALESCE((value_json->>'availability_grace_period_minutes')::numeric, 60)), updated_by, updated_at FROM app_settings WHERE key = 'retention';

-- Delete legacy grouped composite rows
DELETE FROM app_settings WHERE key IN ('monetization', 'auth_settings', 'matching_settings', 'moderation', 'moderation_settings', 'retention');

-- Insert unbundled settings into app_settings
INSERT INTO app_settings (key, value_json, updated_by, updated_at)
SELECT key, value_json, updated_by, updated_at FROM temp_unbundled_settings
ON CONFLICT (key) DO UPDATE
SET value_json = EXCLUDED.value_json,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

-- Audit entry for the migration
INSERT INTO settings_audit (admin_email, key, old_value, new_value, ip_address, user_agent)
SELECT 'system:migration', key, 'null'::jsonb, value_json, '127.0.0.1', 'Migration 011'
FROM app_settings;

COMMIT;
```

---

## 3. In-Memory Caching & Database Outage Resilience

All reads are served from an in-memory `SettingsRegistryService` in process memory.

### 3.1 Cache Operations: update() and reset()

*   **`update(key, value, adminId, adminEmail, ipAddress)`:**
    1.  Validates key existence and value against Zod schema.
    2.  Begins a database transaction.
    3.  Queries current value with row locking:
        ```sql
        SELECT value_json FROM app_settings WHERE key = $1 FOR UPDATE;
        ```
    4.  Applies cross-field safety rules (e.g. SMS provider check, rate limit floors).
    5.  Upserts new value into `app_settings`.
    6.  Inserts record into `settings_audit` with `old_value` and `new_value`.
    7.  Commits transaction.
    8.  Immediately updates in-memory cache: `cache.set(key, parsedValue)`.
    9.  *Cache is NEVER updated if the database transaction fails.*
*   **`reset(key, adminId, adminEmail, ipAddress)`:**
    1.  Validates key existence in registry.
    2.  Begins a database transaction.
    3.  Locks row:
        ```sql
        SELECT value_json FROM app_settings WHERE key = $1 FOR UPDATE;
        ```
    4.  Deletes override: `DELETE FROM app_settings WHERE key = $1;`.
    5.  Inserts record into `settings_audit` logging reset to default.
    6.  Commits transaction.
    7.  Refreshes cache to code default: `cache.set(key, meta.default)`.

### 3.2 Database Outage Behavior

*   **Runtime Disconnection:** In-memory cache continues serving all reads with 0ms latency. Admin writes return `503 Service Unavailable` with message `"Database connection unavailable. Settings are read-only."`
*   **Startup Failure:** If PostgreSQL is offline when the server starts, `SettingsRegistryService` logs a warning, loads all code defaults into memory, and enters degraded "Safe Default Mode".

---

## 4. Snapshotting at MATCH Time

When a call session is matched and created in `matching.service.js`, the active parameters are snapshotted into the `call_sessions` row:

*   `snapshot_mode`: Active `monetization_mode` (`free`, `subscription`, `per_minute`).
*   `snapshot_rate_per_minute`: Active `billing_rate_per_minute` (e.g. `1.00`).
*   `snapshot_ring_timeout`: Active `ring_timeout_seconds` (e.g. `30`).
*   `snapshot_max_duration`: Active `max_call_duration_seconds` (e.g. `3600`).
*   `snapshot_currency`: Fixed `'INR'`.

---

## 5. Cross-Field, Safety & Operational Rules

### 5.1 Mobile Login & SMS Gateway Lockout
*   **Production:** `mobile_login_enabled` **cannot** be enabled in production unless `config.smsProviderConfigured` is `true` (derived from environment variables e.g. `SMS_GATEWAY_API_KEY` or `TWILIO_AUTH_TOKEN`). If unconfigured, `update()` throws an error: `"Cannot enable mobile login in production: No SMS provider configured."`
*   **Non-Production:** Mobile login is allowed to be enabled. OTP codes are logged to console.
*   **Status Endpoint:** `GET /admin/settings/status` returns `{ "sms_provider_configured": boolean, "environment": string }`.

### 5.2 Mandatory HTTPS for Remote URLs
*   `privacy_policy_url` default: `https://anoncall-admin.duckdns.org/privacy.html`
*   `terms_of_service_url` default: `https://anoncall-admin.duckdns.org/terms.html`
*   Both must begin with `https://`.
*   Static legal pages `privacy.html` and `terms.html` reside in `admin/public/`.

### 5.3 Maintenance Mode Gating
When `maintenance_mode_enabled === true`:
*   New logins (`POST /auth/login`) return `503 Service Unavailable`.
*   New registrations (`POST /auth/register`) return `503 Service Unavailable`.
*   Matchmaking requests (`call:find` socket event) emit `call:error` with `{ reason: 'maintenance', message: 'Platform is undergoing scheduled maintenance.' }`.
*   **Exemptions:**
    *   `GET /health` is NEVER blocked.
    *   `GET /api/v1/config/public` is NEVER blocked.
    *   Admin panel authentication (`POST /admin/auth/login`) is NEVER blocked.
    *   All `/admin/*` routes are NEVER blocked.
    *   Active in-flight call sessions continue without termination.

### 5.4 Numerical Version Gating
*   Client sends `X-App-Version` header (e.g. `"1.0.2"`).
*   Server numerically compares client version components `[major, minor, patch]` against `min_supported_mobile_version`.
*   If `client_version < min_supported_mobile_version`:
    *   `POST /auth/login` and `POST /auth/register` return `426 Upgrade Required`.
    *   `call:find` socket event emits `call:error` with `{ reason: 'update_required', min_version: '...', force_update_url: '...' }`.

---

## 6. Public Configuration API Specification

*   **Route:** `GET /api/v1/config/public`
*   **Access:** Public (Rate-limited, no auth token required)
*   **Header:** `Cache-Control: no-store`

### Response Schema

```json
{
  "maintenance": {
    "enabled": false,
    "message": "Platform is undergoing scheduled maintenance. Please check back shortly."
  },
  "version_gating": {
    "min_supported_version": "1.0.0",
    "force_update_url": "https://play.google.com/store/apps/details?id=com.hemal.anonaudiocall"
  },
  "auth": {
    "registration_enabled": true,
    "email_login_enabled": true,
    "mobile_login_enabled": false,
    "password_min_length": 8,
    "otp_expiry_seconds": 300,
    "otp_resend_cooldown_seconds": 60
  },
  "calls": {
    "ring_timeout_seconds": 30,
    "disconnect_grace_period_seconds": 5,
    "max_call_duration_seconds": 3600
  },
  "monetization": {
    "mode": "free",
    "currency": "INR",
    "rate_per_minute": 1.00,
    "minimum_balance": 5.00,
    "free_trial_minutes_new_user": 10,
    "free_daily_minute_cap": 30,
    "subscription_plans": [
      { "id": "1", "name": "Starter Pass", "price": 49.00, "duration_days": 30, "active": true },
      { "id": "2", "name": "Unlimited Monthly", "price": 99.00, "duration_days": 30, "active": true }
    ]
  },
  "moderation": {
    "report_note_max_length": 1000
  },
  "legal": {
    "privacy_policy_url": "https://anoncall-admin.duckdns.org/privacy.html",
    "terms_of_service_url": "https://anoncall-admin.duckdns.org/terms.html",
    "active_terms_version": "1.0",
    "active_privacy_version": "1.0",
    "min_registration_age": 18
  }
}
```

---

## 7. Canonical Settings Registry Table

Below is the definitive catalog of all **47 settings** managed by the Settings Registry.

| # | Setting Key | Group (Tab) | Type | Min | Max | Default | Unit | Scope | Apply Timing |
| :-: | :--- | :--- | :--- | :---: | :---: | :--- | :---: | :---: | :---: |
| **1** | `maintenance_mode_enabled` | System | boolean | — | — | `false` | — | **Public** | Instant |
| **2** | `maintenance_mode_message` | System | string | 1 | 500 | `"Platform is undergoing..."` | chars | **Public** | Instant |
| **3** | `min_supported_mobile_version` | System | string | — | — | `"1.0.0"` | semver | **Public** | Instant |
| **4** | `force_update_store_url_android` | System | string | — | — | `"https://play.google.com/..."` | url | **Public** | Instant |
| **5** | `user_registration_enabled` | Auth & OTP | boolean | — | — | `true` | — | **Public** | Instant |
| **6** | `email_login_enabled` | Auth & OTP | boolean | — | — | `true` | — | **Public** | Instant |
| **7** | `mobile_login_enabled` | Auth & OTP | boolean | — | — | `false` | — | **Public** | Instant |
| **8** | `user_password_min_length` | Auth & OTP | integer | 8 | 64 | `8` | chars | **Public** | Instant |
| **9** | `otp_expiry_seconds` | Auth & OTP | integer | 60 | 900 | `300` | seconds | **Public** | Instant |
| **10** | `otp_max_verify_attempts` | Auth & OTP | integer | 1 | 10 | `3` | attempts | **Private** | Instant |
| **11** | `otp_resend_cooldown_seconds` | Auth & OTP | integer | 15 | 300 | `60` | seconds | **Public** | Instant |
| **12** | `cooldown_same_peer_seconds` | Matching & Calls | integer | 0 | 86400 | `60` | seconds | **Private** | Instant |
| **13** | `max_match_attempts` | Matching & Calls | integer | 1 | 10 | `3` | attempts | **Private** | New Calls |
| **14** | `try_live_presence_first` | Matching & Calls | boolean | — | — | `true` | — | **Private** | Instant |
| **15** | `ring_timeout_seconds` | Matching & Calls | integer | 10 | 120 | `30` | seconds | **Public** | New Calls |
| **16** | `network_disconnect_grace_period_seconds` | Matching & Calls | integer | 2 | 30 | `5` | seconds | **Public** | New Calls |
| **17** | `max_call_duration_seconds` | Matching & Calls | integer | 300 | 86400 | `3600` | seconds | **Public** | New Calls |
| **18** | `monetization_mode` | Billing | enum | — | — | `'free'` | mode | **Public** | Instant |
| **19** | `billing_rate_per_minute` | Billing | float | 0.01 | 1000.0 | `1.00` | INR/min | **Public** | New Calls |
| **20** | `billing_minimum_balance` | Billing | float | 0.00 | 500.0 | `5.00` | INR | **Public** | Instant |
| **21** | `free_trial_minutes_new_user` | Billing | integer | 0 | 600 | `10` | minutes | **Public** | Instant |
| **22** | `free_daily_minute_cap` | Billing | integer | 0 | 1440 | `30` | minutes | **Public** | Instant |
| **23** | `subscription_plans` | Billing | array | — | — | `[Starter, Unlimited]` | array | **Public** | Instant |
| **24** | `auto_flag_report_threshold` | Moderation | integer | 1 | 20 | `3` | reports | **Private** | Instant |
| **25** | `auto_suspend_report_threshold` | Moderation | integer | 1 | 50 | `5` | reports | **Private** | Instant |
| **26** | `auto_suspend_window_hours` | Moderation | integer | 1 | 168 | `24` | hours | **Private** | Instant |
| **27** | `auto_suspension_duration_hours` | Moderation | integer | 1 | 720 | `48` | hours | **Private** | Instant |
| **28** | `report_note_max_length` | Moderation | integer | 100 | 5000 | `1000` | chars | **Public** | Instant |
| **29** | `rate_limit_global_max` | Limits | integer | 50 | 5000 | `300` | req/15m | **Private** | Instant |
| **30** | `rate_limit_register_max` | Limits | integer | 1 | 100 | `10` | req/15m | **Private** | Instant |
| **31** | `rate_limit_login_ip_max` | Limits | integer | 5 | 100 | `10` | req/15m | **Private** | Instant |
| **32** | `rate_limit_login_account_max` | Limits | integer | 3 | 50 | `5` | req/15m | **Private** | Instant |
| **33** | `rate_limit_otp_request_max` | Limits | integer | 1 | 50 | `5` | req/15m | **Private** | Instant |
| **34** | `rate_limit_otp_request_phone_max` | Limits | integer | 1 | 20 | `3` | req/15m | **Private** | Instant |
| **35** | `socket_skip_cancel_threshold` | Limits | integer | 2 | 20 | `5` | actions | **Private** | Instant |
| **36** | `socket_skip_cancel_cooldown_ms` | Limits | integer | 5000 | 300000 | `30000` | ms | **Private** | Instant |
| **37** | `socket_rate_limit_call_find_max` | Limits | integer | 2 | 60 | `10` | req/min | **Private** | Instant |
| **38** | `socket_rate_limit_signal_max` | Limits | integer | 20 | 300 | `60` | req/min | **Private** | Instant |
| **39** | `socket_max_malformed_events` | Limits | integer | 1 | 20 | `5` | events | **Private** | Instant |
| **40** | `availability_grace_period_minutes` | Retention | integer | 5 | 1440 | `60` | minutes | **Private** | Instant |
| **41** | `call_history_retention_days` | Retention | integer | 7 | 730 | `90` | days | **Private** | Instant |
| **42** | `privacy_policy_url` | Legal & Text | string | — | — | `"https://anoncall-admin..."`| url | **Public** | Instant |
| **43** | `terms_of_service_url` | Legal & Text | string | — | — | `"https://anoncall-admin..."`| url | **Public** | Instant |
| **44** | `active_terms_version` | Legal & Text | string | 1 | 20 | `"1.0"` | version | **Public** | Instant |
| **45** | `active_privacy_version` | Legal & Text | string | 1 | 20 | `"1.0"` | version | **Public** | Instant |
| **46** | `push_notification_title` | Legal & Text | string | 1 | 100 | `"Incoming call"` | text | **Private** | Instant |
| **47** | `push_notification_body` | Legal & Text | string | 1 | 200 | `"Someone wants to talk"` | text | **Private** | Instant |
