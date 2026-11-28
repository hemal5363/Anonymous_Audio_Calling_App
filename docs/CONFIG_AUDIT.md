# Configuration & Constants Audit

**Target Systems:** `backend/`, `admin/`, `mobile/`  
**Date:** November 2026  
**Status:** Complete Audit Report  
**Constraint:** Strict read-only on code. No application code modified.

---

## Executive Summary & Scope

This audit exhaustively catalogs every hardcoded value, environment variable, magic number, SQL interval, timeout, default parameter, and user-visible string that governs system behavior across the Anonymous Audio Calling platform.

### Classification Categories

Every identified configuration item is categorized into one of three classifications:

*   **Group A: Business / Behavior Setting (Admin Configurable)**  
    Parameters that define business rules, user experience, monetization, rate limits, timeouts, and platform policies. These settings should be dynamically managed from the Admin Panel via `app_settings` without requiring code changes or server redeployments.
*   **Group B: Secret or Infrastructure Value (`.env` Bound)**  
    Credentials, cryptographic signing keys, database connection strings, network bindings, and server ports that must remain in `.env`. Storing these in a database or exposing them via an admin interface introduces severe security vulnerabilities or bootstrap circular dependencies.
*   **Group C: Technical Constant (Fixed Invariant)**  
    Protocol event names, media constraints, database primary key names, standard HTTP headers, WebRTC signaling state strings, and mobile native permissions. Changing these at runtime would break protocol contracts, mobile operating system sandboxes, or WebRTC standard handshakes.

---

## 1. Current State of `app_settings` in Database

The backend database currently contains an `app_settings` table (`key VARCHAR(64) PRIMARY KEY`, `value_json JSONB`, `updated_by UUID`, `updated_at TIMESTAMP`). The table currently holds five active configuration keys:

| Key | Current JSON Value | Admin UI Manageable Today? |
| :--- | :--- | :--- |
| `monetization` | `{"mode": "free", "currency": "INR", "minimum_balance": 5, "per_minute_rate": 1, "free_daily_minute_cap": 30, "free_trial_minutes_new_user": 10, "subscription_plans": [...]}` | **Yes** (SettingsPage: Mode, Currency, Rate, Min Balance, Trial Mins, Daily Cap) |
| `auth_settings` | `{"email_login_enabled": true, "mobile_login_enabled": false, "otp_expiry_seconds": 300, "max_otp_attempts": 3}` | **Yes** (SettingsPage: Login toggles, OTP expiry, Max attempts) |
| `matching_settings`| `{"ring_timeout_seconds": 30, "max_match_attempts": 3, "try_live_presence_first": true, "cooldown_same_peer_seconds": 60}` | **Yes** (SettingsPage: Same-peer rematch cooldown field & presets) |
| `moderation` / `moderation_settings` | `{"flag_report_threshold": 3}` / `{"auto_suspend_report_threshold": 3, "auto_suspend_window_hours": 24, "suspension_duration_hours": 48}` | **Partial** (Key split between `moderation` and `moderation_settings`) |
| `retention` | `{"call_history_retention_days": 90, "availability_grace_period_minutes": 60}` | **No** (Direct DB seed only, no Admin UI card) |

---

## 2. Fragmented & Multi-Location Hardcoded Settings

Several critical settings exist in `app_settings` or `.env` in theory, but in practice are hardcoded in application logic, embedded directly in SQL queries, or duplicated across client and server.

```
+---------------------------------------------------------------------------------------------------+
|                                 FRAGMENTATION AUDIT MATRIX                                        |
+------------------------------+---------------------------+----------------------------------------+
| Setting Domain               | Canonical Target          | Hardcoded Fragment Locations           |
+------------------------------+---------------------------+----------------------------------------+
| New User Free Trial Minutes  | app_settings.monetization | 1. auth.controller.js:123 (SQL insert) |
|                              |                           | 2. auth.controller.js:467 (SQL insert) |
|                              |                           | 3. billing.controller.js:23 (fallback) |
|                              |                           | 4. billing.service.js:37 (fallback)    |
+------------------------------+---------------------------+----------------------------------------+
| Ring Timeout Seconds         | matching_settings         | 1. socket/index.js:350 (30000ms)       |
|                              |                           | 2. callSessionManager.js:26 (30000ms)  |
|                              |                           | 3. user.controller.js:573 (>30s check) |
|                              |                           | 4. push.js:114 (ttl: 30)               |
|                              |                           | 5. cleanup.service.js:96 (60s ring)    |
|                              |                           | 6. mobile CallContext.tsx:144 (30s)    |
|                              |                           | 7. mobile IncomingCallScreen:20 (30s)  |
+------------------------------+---------------------------+----------------------------------------+
| OTP Expiry & Resend Cooldown | auth_settings             | 1. auth.controller.js:322 (5 min SQL)  |
|                              |                           | 2. auth.controller.js:290 (60s SQL)    |
|                              |                           | 3. auth.controller.js:322 (3 attempts) |
+------------------------------+---------------------------+----------------------------------------+
| Auto-Flag Moderation Reports | moderation_settings       | 1. user.controller.js:432 (reads       |
|                              |                           |    'moderation', fallback 3)           |
|                              |                           | 2. call.service.js:318 (reads          |
|                              |                           |    'moderation', fallback 3)           |
+------------------------------+---------------------------+----------------------------------------+
| Availability Grace Period    | retention                 | 1. cleanup.service.js:165 (fallback 60)|
+------------------------------+---------------------------+----------------------------------------+
| Call History Retention Days  | retention                 | 1. cleanup.service.js:230 (fallback 90)|
+------------------------------+---------------------------+----------------------------------------+
| STUN/TURN URLs & TTL         | config / .env             | 1. config/index.js:41 (defaults)       |
|                              |                           | 2. AudioEngine.ts:189 (fallback STUN)  |
|                              |                           | 3. docs/CALL_FLOW.md:46 (hardcoded)    |
+------------------------------+---------------------------+----------------------------------------+
| Terms & Privacy Versions     | users table defaults      | 1. auth.controller.js:21-22 ('1.0')    |
|                              |                           | 2. SettingsScreen.tsx:106 ('1.0')      |
+------------------------------+---------------------------+----------------------------------------+
```

---

## 3. Group A: Business & Behavior Settings (Admin Panel Candidates)

All settings in this section should be configurable from the Admin Panel. Each setting includes proposed parameter specifications, validation boundaries, client visibility, and application timing rules.

### A.1 System Maintenance, Gating & Mobile App Versioning

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `maintenance_mode_enabled` |
| **Type** | `boolean` |
| **Min / Max** | `false` / `true` |
| **Default** | `false` |
| **Scope** | **Public** (Exposed to Mobile Client) |
| **Propagation** | **Instant** (Checked on app foreground, socket handshake, and API requests) |
| **Current Location** | Absent (Implicitly open in `backend/src/app.js:1`) |
| **Controlled Behavior** | When `true`, disables matching, returns 503 Service Unavailable to client calls, and shows maintenance screen in mobile app. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `maintenance_mode_message` |
| **Type** | `string` |
| **Min / Max** | 1 to 500 characters |
| **Default** | `"Platform is undergoing scheduled maintenance. Please check back shortly."` |
| **Scope** | **Public** |
| **Propagation** | **Instant** |
| **Current Location** | Absent |
| **Controlled Behavior** | User-facing banner message displayed on mobile screens during maintenance. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `min_supported_mobile_version` |
| **Type** | `string` (SemVer format `X.Y.Z`) |
| **Min / Max** | SemVer string (e.g., `1.0.0` to `99.99.99`) |
| **Default** | `"1.0.0"` |
| **Scope** | **Public** |
| **Propagation** | **Instant** (Checked upon app startup / splash screen) |
| **Current Location** | `mobile/app.config.js:5` (`version: '1.0.0'`) |
| **Controlled Behavior** | Enforces mandatory client upgrade. If client app SemVer is lower than this value, client locks UI and prompts user to update. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `force_update_store_url_android` |
| **Type** | `string` (URI) |
| **Min / Max** | Valid HTTPS / Market URL |
| **Default** | `"https://play.google.com/store/apps/details?id=com.hemal.anonaudiocall"` |
| **Scope** | **Public** |
| **Propagation** | **Instant** |
| **Current Location** | `mobile/app.config.js:19` (`com.hemal.anonaudiocall`) |
| **Controlled Behavior** | Target link when the user taps "Update Now" upon version obsolescence. |

---

### A.2 User Registration, Authentication & Session Durations

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `user_registration_enabled` |
| **Type** | `boolean` |
| **Min / Max** | `false` / `true` |
| **Default** | `true` |
| **Scope** | **Public** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/controllers/auth.controller.js:82` (Endpoint currently unconditionally creates accounts) |
| **Controlled Behavior** | When `false`, halts new account registrations with error `"New user registrations are temporarily paused."` |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `email_login_enabled` |
| **Type** | `boolean` |
| **Min / Max** | `false` / `true` |
| **Default** | `true` |
| **Scope** | **Public** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/controllers/auth.controller.js:189`, `admin/src/pages/SettingsPage.jsx:689` |
| **Controlled Behavior** | Enables or disables email/password login authentication method. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `mobile_login_enabled` |
| **Type** | `boolean` |
| **Min / Max** | `false` / `true` |
| **Default** | `false` |
| **Scope** | **Public** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/controllers/auth.controller.js:275`, `admin/src/pages/SettingsPage.jsx:710` |
| **Controlled Behavior** | Enables or disables phone number SMS OTP login method. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `user_password_min_length` |
| **Type** | `integer` |
| **Min / Max** | `8` to `64` characters |
| **Default** | `8` |
| **Scope** | **Public** |
| **Propagation** | **Instant** (Affects subsequent registration and password reset attempts) |
| **Current Location** | `backend/src/controllers/auth.controller.js:33` (`password: z.string().min(8)`) |
| **Controlled Behavior** | Minimum character length enforced during user registration. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `user_jwt_access_token_ttl_minutes` |
| **Type** | `integer` |
| **Min / Max** | `5` to `1440` minutes (1 day) |
| **Default** | `15` |
| **Scope** | **Private** |
| **Propagation** | **New Sessions** (Applies when new tokens are minted) |
| **Current Location** | `backend/src/utils/token.js:18` (`expiresIn: '15m'`) |
| **Controlled Behavior** | Validity lifespan of short-lived user JWT access tokens. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `user_refresh_token_ttl_days` |
| **Type** | `integer` |
| **Min / Max** | `1` to `90` days |
| **Default** | `7` |
| **Scope** | **Private** |
| **Propagation** | **New Sessions** |
| **Current Location** | `backend/src/controllers/auth.controller.js:137, 234, 481, 610` (`INTERVAL '7 days'`), `backend/src/utils/token.js:48` |
| **Controlled Behavior** | Lifespan of rotating user refresh tokens stored in database. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `admin_jwt_access_token_ttl_hours` |
| **Type** | `integer` |
| **Min / Max** | `1` to `24` hours |
| **Default** | `12` |
| **Scope** | **Private** |
| **Propagation** | **New Sessions** |
| **Current Location** | `backend/src/utils/token.js:34` (`expiresIn: '12h'`) |
| **Controlled Behavior** | Validity lifespan of admin panel in-memory JWT tokens. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `admin_max_login_attempts` |
| **Type** | `integer` |
| **Min / Max** | `3` to `10` attempts |
| **Default** | `5` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:126`, `backend/src/controllers/admin.controller.js:146` |
| **Controlled Behavior** | Number of failed login attempts before an administrator account is locked out. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `admin_lockout_duration_minutes` |
| **Type** | `integer` |
| **Min / Max** | `5` to `1440` minutes |
| **Default** | `15` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:129`, `backend/src/controllers/admin.controller.js:146` |
| **Controlled Behavior** | Duration an admin account remains locked after exceeding max login attempts. |

---

### A.3 OTP & Phone Verification Policy

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `otp_expiry_seconds` |
| **Type** | `integer` |
| **Min / Max** | `60` to `900` seconds (15 minutes) |
| **Default** | `300` (5 minutes) |
| **Scope** | **Public** (Mobile UI needs to show expiry countdown) |
| **Propagation** | **Instant** (Applies to all newly requested OTP codes) |
| **Current Location** | In `app_settings.auth_settings`, but hardcoded in SQL `backend/src/controllers/auth.controller.js:322` (`INTERVAL '5 minutes'`) |
| **Controlled Behavior** | Expiry window for SMS one-time login/registration codes. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `otp_max_verify_attempts` |
| **Type** | `integer` |
| **Min / Max** | `1` to `10` attempts |
| **Default** | `3` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | In `app_settings.auth_settings`, but hardcoded in SQL `backend/src/controllers/auth.controller.js:322` (`attempts_left: 3`) |
| **Controlled Behavior** | Maximum failed verification guesses before an OTP is invalidated. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `otp_resend_cooldown_seconds` |
| **Type** | `integer` |
| **Min / Max** | `15` to `300` seconds |
| **Default** | `60` |
| **Scope** | **Public** (Drives mobile resend countdown timer) |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/controllers/auth.controller.js:290` (`INTERVAL '60 seconds'`) |
| **Controlled Behavior** | Minimum wait time required before a user can request another OTP code. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `otp_purge_retention_hours` |
| **Type** | `integer` |
| **Min / Max** | `1` to `168` hours (7 days) |
| **Default** | `24` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/services/cleanup.service.js:62` (`INTERVAL '24 hours'`) |
| **Controlled Behavior** | Age threshold after which expired OTP records are pruned from the database. |

---

### A.4 Matching Engine, Discovery & Same-Peer Cooldown

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `cooldown_same_peer_seconds` |
| **Type** | `integer` |
| **Min / Max** | `0` to `86400` seconds (24 hours) |
| **Default** | `60` |
| **Scope** | **Private** |
| **Propagation** | **Instant** (Dynamically read on each match execution with cache busting) |
| **Current Location** | `backend/src/services/matching.service.js:18-45`, `admin/src/pages/SettingsPage.jsx:778` |
| **Controlled Behavior** | Duration two users must wait before being paired together again in random matching. `0` disables same-peer cooldown. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `max_match_attempts` |
| **Type** | `integer` |
| **Min / Max** | `1` to `10` attempts |
| **Default** | `3` |
| **Scope** | **Private** |
| **Propagation** | **New Calls** |
| **Current Location** | `app_settings.matching_settings` (`max_match_attempts: 3`) |
| **Controlled Behavior** | Number of candidate retry attempts before returning `"no_users_available"` to caller. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `try_live_presence_first` |
| **Type** | `boolean` |
| **Min / Max** | `false` / `true` |
| **Default** | `true` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `app_settings.matching_settings` (`try_live_presence_first: true`), `backend/src/services/matching.service.js:115` |
| **Controlled Behavior** | Prioritizes users with active socket connections before falling back to push notification matching. |

---

### A.5 Call Session Lifecycle, Ring Timeouts & Disconnect Grace Periods

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `ring_timeout_seconds` |
| **Type** | `integer` |
| **Min / Max** | `10` to `120` seconds |
| **Default** | `30` |
| **Scope** | **Public** (Sent to mobile client in `call:incoming` event and push notification payload) |
| **Propagation** | **New Calls** |
| **Current Location** | `backend/src/socket/index.js:350` (`ringTimeoutMs: 30000`), `backend/src/socket/callSessionManager.js:26`, `backend/src/services/push.js:114`, `mobile/src/call/CallContext.tsx:144` |
| **Controlled Behavior** | Maximum duration an incoming call will ring a callee before terminating with `ring_timeout` / `missed`. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `stuck_ringing_cleanup_seconds` |
| **Type** | `integer` |
| **Min / Max** | `30` to `300` seconds |
| **Default** | `60` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/services/cleanup.service.js:96` (`INTERVAL '60 seconds'`) |
| **Controlled Behavior** | Periodic sweeper threshold that detects and auto-terminates orphaned ringing calls that failed to emit socket timeout. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `network_disconnect_grace_period_seconds` |
| **Type** | `integer` |
| **Min / Max** | `2` to `30` seconds |
| **Default** | `5` |
| **Scope** | **Public** (Configures client socket reconnection grace window) |
| **Propagation** | **New Calls** |
| **Current Location** | `mobile/src/call/CallContext.tsx:357` (`setTimeout(..., 5000)`) |
| **Controlled Behavior** | Grace period allowed when client socket drops mid-call before tearing down WebRTC media session. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `max_call_duration_seconds` |
| **Type** | `integer` |
| **Min / Max** | `300` to `86400` seconds (5 min to 24 hours) |
| **Default** | `3600` (1 hour) |
| **Scope** | **Public** |
| **Propagation** | **New Calls** |
| **Current Location** | Absent (Indefinite unless balance runs out) |
| **Controlled Behavior** | Maximum allowable duration for any single call session before server auto-hangs up to prevent runaway resource consumption. |

---

### A.6 Monetization, Per-Minute Pricing, Wallets & Daily Usage Caps

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `monetization_mode` |
| **Type** | `enum('free', 'subscription', 'per_minute')` |
| **Values** | `'free'`, `'subscription'`, `'per_minute'` |
| **Default** | `'free'` |
| **Scope** | **Public** (Drives mobile wallet UI rendering and billing flow) |
| **Propagation** | **Instant** (Next call or minute pulse evaluates new mode) |
| **Current Location** | `app_settings.monetization.mode`, `backend/src/services/billing.service.js:47`, `admin/src/pages/SettingsPage.jsx:62` |
| **Controlled Behavior** | Master switch for platform monetization model. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `billing_currency` |
| **Type** | `string` (ISO 4217 Currency Code) |
| **Min / Max** | 3 characters (e.g. `'INR'`, `'USD'`, `'EUR'`) |
| **Default** | `'INR'` |
| **Scope** | **Public** |
| **Propagation** | **Instant** |
| **Current Location** | `app_settings.monetization.currency`, `backend/src/services/billing.service.js:48`, `mobile/src/screens/WalletScreen.tsx:275` |
| **Controlled Behavior** | Default display and transaction currency. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `billing_rate_per_minute` |
| **Type** | `float` |
| **Min / Max** | `0.01` to `1000.00` |
| **Default** | `1.00` |
| **Scope** | **Public** |
| **Propagation** | **New Calls** |
| **Current Location** | `app_settings.monetization.per_minute_rate`, `backend/src/services/billing.service.js:186`, `admin/src/pages/SettingsPage.jsx:22` |
| **Controlled Behavior** | Amount debited per minute of active call time in `per_minute` mode. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `billing_minimum_balance` |
| **Type** | `float` |
| **Min / Max** | `0.00` to `500.00` |
| **Default** | `5.00` |
| **Scope** | **Public** |
| **Propagation** | **Instant** (Checked prior to placing calls) |
| **Current Location** | `app_settings.monetization.minimum_balance`, `backend/src/services/billing.service.js:49`, `admin/src/pages/SettingsPage.jsx:23` |
| **Controlled Behavior** | Minimum prepaid balance required to initiate a new call. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `free_trial_minutes_new_user` |
| **Type** | `integer` |
| **Min / Max** | `0` to `600` minutes |
| **Default** | `10` |
| **Scope** | **Public** |
| **Propagation** | **Instant** (Applies to all newly registered user wallets) |
| **Current Location** | In `app_settings.monetization`, but bypassed by hardcoded `10` in `backend/src/controllers/auth.controller.js:123, 467` |
| **Controlled Behavior** | Free call minutes credited to a user's wallet upon account creation. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `free_daily_minute_cap` |
| **Type** | `integer` (nullable) |
| **Min / Max** | `0` to `1440` minutes (0 or null = unlimited) |
| **Default** | `30` |
| **Scope** | **Public** |
| **Propagation** | **Instant** |
| **Current Location** | `app_settings.monetization.free_daily_minute_cap`, `backend/src/services/billing.service.js:62`, `admin/src/pages/SettingsPage.jsx:25` |
| **Controlled Behavior** | Maximum daily minutes allowed per user when platform operates in `free` mode. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `billing_pulse_interval_ms` |
| **Type** | `integer` |
| **Min / Max** | `10000` to `300000` ms (10s to 5m) |
| **Default** | `60000` (1 minute) |
| **Scope** | **Private** |
| **Propagation** | **New Calls** |
| **Current Location** | `backend/src/services/billing.service.js:402` (`intervalMs = 60000`) |
| **Controlled Behavior** | Server billing timer pulse that triggers minute decrement and balance checks. |

---

### A.7 Safety Moderation, Reporting & Auto-Suspension Thresholds

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `auto_flag_report_threshold` |
| **Type** | `integer` |
| **Min / Max** | `1` to `20` distinct reporters |
| **Default** | `3` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/controllers/user.controller.js:431` (fallback 3), `backend/src/services/call.service.js:318` (fallback 3) |
| **Controlled Behavior** | Number of unique user abuse reports required before an account is auto-flagged (`is_flagged = true`) for moderator review. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `auto_suspend_report_threshold` |
| **Type** | `integer` |
| **Min / Max** | `1` to `50` distinct reports |
| **Default** | `5` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `app_settings.moderation_settings.auto_suspend_report_threshold` |
| **Controlled Behavior** | Number of abuse reports within window before account is automatically suspended. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `auto_suspend_window_hours` |
| **Type** | `integer` |
| **Min / Max** | `1` to `168` hours (7 days) |
| **Default** | `24` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `app_settings.moderation_settings.auto_suspend_window_hours` |
| **Controlled Behavior** | Rolling time window for accumulating abuse reports toward auto-suspension. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `auto_suspension_duration_hours` |
| **Type** | `integer` |
| **Min / Max** | `1` to `720` hours (30 days) |
| **Default** | `48` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `app_settings.moderation_settings.suspension_duration_hours` |
| **Controlled Behavior** | Duration an automatically suspended user remains blocked before suspension lifts. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `report_note_max_length` |
| **Type** | `integer` |
| **Min / Max** | `100` to `5000` characters |
| **Default** | `1000` |
| **Scope** | **Public** (Sets mobile text input `maxLength`) |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/controllers/user.controller.js:363` (`z.string().max(1000)`) |
| **Controlled Behavior** | Maximum character length allowed in abuse report explanation note. |

---

### A.8 Automated Background Jobs, Inactivity Pruning & Data Retention

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `availability_grace_period_minutes` |
| **Type** | `integer` |
| **Min / Max** | `5` to `1440` minutes |
| **Default** | `60` |
| **Scope** | **Private** |
| **Propagation** | **Instant** (Evaluated on next cleanup run) |
| **Current Location** | `app_settings.retention.availability_grace_period_minutes`, fallback `60` in `backend/src/services/cleanup.service.js:165` |
| **Controlled Behavior** | Inactivity threshold after which idle users (`is_available = true`) are set to unavailable (`is_available = false`). |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `call_history_retention_days` |
| **Type** | `integer` |
| **Min / Max** | `7` to `730` days (2 years) |
| **Default** | `90` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `app_settings.retention.call_history_retention_days`, fallback `90` in `backend/src/services/cleanup.service.js:230` |
| **Controlled Behavior** | Retention period for completed call logs and signaling events before automated deletion. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `cleanup_service_interval_ms` |
| **Type** | `integer` |
| **Min / Max** | `30000` to `3600000` ms (30s to 1h) |
| **Default** | `300000` (5 minutes) |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/services/cleanup.service.js:288` (`intervalMs = 5 * 60 * 1000`) |
| **Controlled Behavior** | Frequency at which the background database janitor job executes. |

---

### A.9 WebRTC STUN/TURN Public Endpoints & Token Lifetimes

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `webrtc_stun_urls` |
| **Type** | `string` (comma-separated STUN URIs) |
| **Min / Max** | 1 to 500 characters |
| **Default** | `"stun:stun.l.google.com:19302"` |
| **Scope** | **Public** (Passed to client in ICE server configuration) |
| **Propagation** | **New Calls** |
| **Current Location** | `backend/src/config/index.js:41`, `mobile/src/call/AudioEngine.ts:189` |
| **Controlled Behavior** | Public STUN servers for NAT traversal candidate discovery. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `webrtc_turn_url` |
| **Type** | `string` (TURN URI) |
| **Min / Max** | 1 to 500 characters |
| **Default** | `"turn:anoncall-api.duckdns.org:3478"` |
| **Scope** | **Public** (Passed to client in ICE server configuration) |
| **Propagation** | **New Calls** |
| **Current Location** | `backend/src/config/index.js:43` |
| **Controlled Behavior** | Public Coturn relay server URL. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `webrtc_turn_credential_ttl_seconds` |
| **Type** | `integer` |
| **Min / Max** | `300` to `86400` seconds (5 min to 24h) |
| **Default** | `3600` (1 hour) |
| **Scope** | **Private** (Used by backend HMAC generator) |
| **Propagation** | **New Calls** |
| **Current Location** | `backend/src/config/index.js:50` (`TURN_TTL: 3600`) |
| **Controlled Behavior** | Expiration timestamp duration baked into ephemeral Coturn REST API credentials. |

---

### A.10 Push Notification Templates, Channels & Sound

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `push_notification_title` |
| **Type** | `string` |
| **Min / Max** | 1 to 100 characters |
| **Default** | `"Incoming call"` |
| **Scope** | **Private** (Sent via server-side Expo Push API) |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/services/push.js:110` (`title: 'Incoming call'`) |
| **Controlled Behavior** | Title displayed on device lockscreen for incoming anonymous calls. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `push_notification_body` |
| **Type** | `string` |
| **Min / Max** | 1 to 200 characters |
| **Default** | `"Someone wants to talk"` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/services/push.js:111` (`body: 'Someone wants to talk'`) |
| **Controlled Behavior** | Body text displayed on device notification banner. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `push_notification_receipt_delay_ms` |
| **Type** | `integer` |
| **Min / Max** | `10000` to `300000` ms (10s to 5m) |
| **Default** | `60000` (1 minute) |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/services/push.js:66, 139` (`delayMs = 60000`) |
| **Controlled Behavior** | Delay before querying Expo Push receipt service to detect invalid device tokens (`DeviceNotRegistered`). |

---

### A.11 Mobile User-Visible Compliance Text, Legal URLs & Disclosures

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `privacy_policy_url` |
| **Type** | `string` (URI) |
| **Min / Max** | Valid HTTPS URL |
| **Default** | `"https://anonaudiocall.com/privacy"` |
| **Scope** | **Public** |
| **Propagation** | **Instant** |
| **Current Location** | `mobile/src/components/PrivacyPolicyModal.tsx:21` |
| **Controlled Behavior** | Destination opened when user taps "View Hosted Privacy Policy Online" (required by Google Play Store guidelines). |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `terms_of_service_url` |
| **Type** | `string` (URI) |
| **Min / Max** | Valid HTTPS URL |
| **Default** | `"https://anonaudiocall.com/terms"` |
| **Scope** | **Public** |
| **Propagation** | **Instant** |
| **Current Location** | `mobile/src/screens/RegisterScreen.tsx:171` |
| **Controlled Behavior** | Web link for Terms of Service agreement. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `active_terms_version` |
| **Type** | `string` |
| **Min / Max** | 1 to 20 characters (e.g. `'1.0'`, `'2.0'`) |
| **Default** | `"1.0"` |
| **Scope** | **Public** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/controllers/auth.controller.js:21`, `mobile/src/screens/SettingsScreen.tsx:106` |
| **Controlled Behavior** | Required legal terms version. Users registered under older versions can be prompted to re-consent. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `active_privacy_version` |
| **Type** | `string` |
| **Min / Max** | 1 to 20 characters |
| **Default** | `"1.0"` |
| **Scope** | **Public** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/controllers/auth.controller.js:22`, `mobile/src/screens/SettingsScreen.tsx:106` |
| **Controlled Behavior** | Required privacy policy version. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `min_registration_age` |
| **Type** | `integer` |
| **Min / Max** | `13` to `21` years |
| **Default** | `18` |
| **Scope** | **Public** |
| **Propagation** | **Instant** |
| **Current Location** | `mobile/src/screens/RegisterScreen.tsx:64, 157` (`18 years of age or older`) |
| **Controlled Behavior** | Minimum legal age confirmation required during account registration. |

---

### A.12 REST API & WebSocket Traffic Limiting & Anti-Abuse Protections

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `rate_limit_global_max` |
| **Type** | `integer` |
| **Min / Max** | `50` to `5000` requests |
| **Default** | `300` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:63`, `backend/src/middleware/rateLimiter.js:26` |
| **Controlled Behavior** | Maximum total HTTP requests per IP within the 15-minute global window. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `rate_limit_register_max` |
| **Type** | `integer` |
| **Min / Max** | `1` to `100` requests |
| **Default** | `10` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:65`, `backend/src/middleware/rateLimiter.js:43` |
| **Controlled Behavior** | Maximum registration attempts per IP within the 15-minute window. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `rate_limit_login_ip_max` |
| **Type** | `integer` |
| **Min / Max** | `1` to `100` requests |
| **Default** | `10` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:67`, `backend/src/middleware/rateLimiter.js:60` |
| **Controlled Behavior** | Maximum login attempts per IP within the 15-minute window. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `rate_limit_login_account_max` |
| **Type** | `integer` |
| **Min / Max** | `1` to `50` requests |
| **Default** | `5` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:68`, `backend/src/middleware/rateLimiter.js:77` |
| **Controlled Behavior** | Maximum login attempts targeting a specific email or phone within the 15-minute window. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `rate_limit_otp_request_max` |
| **Type** | `integer` |
| **Min / Max** | `1` to `50` requests |
| **Default** | `5` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:70`, `backend/src/middleware/rateLimiter.js:95` |
| **Controlled Behavior** | Maximum SMS OTP requests per IP within the 15-minute window. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `rate_limit_otp_request_phone_max` |
| **Type** | `integer` |
| **Min / Max** | `1` to `20` requests |
| **Default** | `3` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:71`, `backend/src/middleware/rateLimiter.js:112` |
| **Controlled Behavior** | Maximum SMS OTP requests per target phone number within the 15-minute window (SMS spam prevention). |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `socket_skip_cancel_threshold` |
| **Type** | `integer` |
| **Min / Max** | `2` to `20` actions |
| **Default** | `5` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:82`, `backend/src/socket/socketAbuseGuard.js:52` |
| **Controlled Behavior** | Number of rapid skips or search cancellations permitted before triggering a matchmaking cooldown penalty. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `socket_skip_cancel_cooldown_ms` |
| **Type** | `integer` |
| **Min / Max** | `5000` to `300000` ms (5s to 5m) |
| **Default** | `30000` (30 seconds) |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:84`, `backend/src/socket/socketAbuseGuard.js:54` |
| **Controlled Behavior** | Duration a user is blocked from matching after triggering rapid skip/cancel abuse. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `socket_rate_limit_call_find_max` |
| **Type** | `integer` |
| **Min / Max** | `2` to `60` events |
| **Default** | `10` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:78`, `backend/src/socket/socketAbuseGuard.js:46` |
| **Controlled Behavior** | Maximum `call:find` socket events permitted per user per 60-second window. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `socket_rate_limit_signal_max` |
| **Type** | `integer` |
| **Min / Max** | `10` to `300` events |
| **Default** | `60` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:79`, `backend/src/socket/socketAbuseGuard.js:47` |
| **Controlled Behavior** | Maximum WebRTC signaling messages (`signal:offer`, `signal:answer`, `signal:ice`) permitted per user per 60-second window. |

| Property | Proposed Specification |
| :--- | :--- |
| **Proposed Setting Key** | `socket_max_malformed_events` |
| **Type** | `integer` |
| **Min / Max** | `1` to `20` violations |
| **Default** | `5` |
| **Scope** | **Private** |
| **Propagation** | **Instant** |
| **Current Location** | `backend/src/config/index.js:81`, `backend/src/socket/socketAbuseGuard.js:51` |
| **Controlled Behavior** | Maximum invalid, non-JSON, or schema-violating socket payloads before socket connection is forcefully disconnected. |

---

## 4. Group B: Secret or Infrastructure Values (`.env` Bound)

The following parameters must remain strictly in environment variables (`.env`). They govern container execution, network port binding, database connectivity, and cryptographic root keys. Storing them in a database would introduce bootstrap paradoxes or severe security vulnerabilities.

| Environment Variable | Current Value / Default | File & Line | Rationale for `.env` Placement |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql://...` | `backend/src/config/index.js:33` | **Bootstrap Dependency:** Database connection parameters must be known *before* the application can connect to read any settings. Exposing DB credentials in an admin panel or database table creates a circular dependency and an attack surface. |
| `JWT_SECRET` | `min 32 chars hex/string` | `backend/src/config/index.js:34` | **Cryptographic Root:** Used to sign all user access tokens with HMAC-SHA256. If stored in a database, a database read breach compromises the entire identity signing infrastructure. |
| `JWT_REFRESH_SECRET` | `min 32 chars hex/string` | `backend/src/config/index.js:35` | **Cryptographic Root:** Used to sign refresh tokens. Compromise allows offline generation of persistent session tokens. |
| `TURN_SECRET` | Secret string | `backend/src/config/index.js:49` | **STUN/TURN Shared Secret:** Used to compute HMAC-SHA1 credentials for Coturn's `use-auth-secret` REST API. Must remain strictly private on the backend host; exposing it allows unauthorized third parties to relay arbitrary WebRTC traffic through server bandwidth. |
| `TURN_USERNAME` / `TURN_PASSWORD` | Optional static auth | `backend/src/config/index.js:46-47` | **Static TURN Credentials:** Fallback credentials for legacy TURN relays. Must not be exposed publicly. |
| `ADMIN_EMAIL` | `admin@example.com` | `backend/.env.example:13` | **Seed Bootstrapping:** Initial root administrator identity used only by `npm run seed` to create the initial admin user. |
| `ADMIN_PASSWORD` | Initial admin pass | `backend/.env.example:14` | **Seed Bootstrapping:** Temporary seed credential. Once seeded, passwords are changed via authenticated `/admin/auth/password` API and stored as bcrypt hashes in `admin_users`. |
| `HOST` | `'0.0.0.0'` | `backend/src/config/index.js:30` | **OS Network Binding:** Configures socket listen interface at OS kernel level before HTTP server boots. |
| `PORT` | `3000` | `backend/src/config/index.js:31` | **OS Port Binding:** Required by container runtimes (Docker, systemd) to bind the process port. |
| `NODE_ENV` | `'development'` | `backend/src/config/index.js:32` | **Runtime Mode:** Node.js runtime environment flag (`development`, `test`, `production`). Controls stack trace generation, R8/ProGuard behavior, and logging format. |
| `LOG_LEVEL` | `'info'` | `backend/src/config/index.js:53` | **Process Logger Config:** Winston/logger verbosity level (`error`, `warn`, `info`, `debug`). |
| `TRUST_PROXY` | `'1'` | `backend/src/config/index.js:54` | **Reverse Proxy Invariant:** Configures Express trust proxy header parsing (`X-Forwarded-For`). Tied directly to Nginx/load balancer architecture. |
| `ADMIN_CORS_ORIGIN` | `http://localhost:5173,...` | `backend/src/config/index.js:51` | **Network Security Policy:** Cross-Origin Resource Sharing whitelist for Admin Panel dashboard. Must match domain of the deployed admin frontend. |
| `EXPO_DEV_ORIGIN` | `http://localhost:8081,...` | `backend/src/config/index.js:52` | **Dev Security Policy:** Metro bundler and Expo developer client CORS origins. |
| `EXPO_PUBLIC_API_URL` | `https://anoncall-api.duckdns.org` | `mobile/src/config/index.ts:6` | **Mobile Build Injection:** Base URL of backend server compiled into the mobile bundle via Expo EAS build environment. Cannot be read from backend database because client needs this URL to reach the backend in the first place. |
| `GOOGLE_SERVICES_JSON` | `./google-services.json` | `mobile/app.config.js:20` | **Firebase Infrastructure File:** Path to FCM credentials for native Android push notification dispatch. |

---

## 5. Group C: Technical Invariants & Protocol Constants

These parameters are fixed technical contracts, protocols, WebRTC media constraints, or operating system requirements. They must never be altered dynamically because doing so would cause protocol desynchronization, audio hardware failures, or native application crashes.

### C.1 WebRTC Audio & Media Pipeline Invariants

| Constant Name | Current Value | File & Line | Technical Rationale / Impact |
| :--- | :--- | :--- | :--- |
| `MediaStream Constraints` | `{ audio: true, video: false }` | `mobile/src/call/AudioEngine.ts:164-166` | **Audio-Only Architecture:** Core architectural guarantee. Video capture is strictly disabled to guarantee privacy, conserve bandwidth, and eliminate video leaks. |
| `Offer Constraints` | `{ offerToReceiveAudio: true, offerToReceiveVideo: false }` | `mobile/src/call/AudioEngine.ts:240-241` | **SDP Media Description:** Tells WebRTC peer connection that client will accept incoming audio tracks but will reject video tracks. |
| `Answer Constraints` | `{ offerToReceiveAudio: true, offerToReceiveVideo: false }` | `mobile/src/call/AudioEngine.ts:262-263` | **SDP Media Description:** Answer counterpart for audio-only SDP negotiation. |
| `ICE Transport Policy` | `hasRealTurn ? 'relay' : 'all'` | `mobile/src/call/AudioEngine.ts:190` | **IP Privacy Protection:** When a valid TURN server is active, forcing `'relay'` hides user public IP addresses from peers by channeling all WebRTC packets through Coturn. When testing locally, `'all'` permits STUN host candidates. |
| `InCallManager Media Mode` | `{ media: 'audio', auto: false }` | `mobile/src/call/AudioEngine.ts:154` | **Hardware Audio Routing:** Configures Android/iOS native audio subsystems for voice call routing (earpiece vs speakerphone) and proximity sensor management. |
| `HMAC Digest Algorithm` | `'sha1'` | `backend/src/config/index.js:256` | **Coturn Protocol Standard:** Coturn's REST API specification (`use-auth-secret`) strictly mandates HMAC-SHA1 to generate valid TURN session tokens. Changing this causes Coturn to reject authentication. |

---

### C.2 Socket.IO Protocol Event Constants

Defined identically in `backend/src/socket/index.js:15-37` and `mobile/src/socket/index.ts:17-43`. Modifying any event name would break communication between client and server.

```
+---------------------------------------------------------------------------------------------------+
|                               SOCKET.IO EVENT NAME INVARIANTS                                     |
+--------------------------+-----------------------+------------------------------------------------+
| Constant Identifier      | Wire Event String     | Flow Direction & Purpose                       |
+--------------------------+-----------------------+------------------------------------------------+
| CALL_FIND                | 'call:find'           | Client -> Server: Request matchmaking          |
| CALL_CANCEL              | 'call:cancel'         | Client -> Server: Abort active search          |
| CALL_INCOMING            | 'call:incoming'       | Server -> Callee: Alert incoming call          |
| CALL_RINGING             | 'call:ringing'        | Server -> Caller: Confirm callee is ringing    |
| CALL_ACCEPT              | 'call:accept'         | Callee -> Server: Accept incoming call         |
| CALL_REJECT              | 'call:reject'         | Callee -> Server: Decline incoming call        |
| CALL_ENDED               | 'call:ended'          | Bidirectional: Terminate active call session   |
| CALL_CONNECTED           | 'call:connected'      | Server -> Both: WebRTC signaling active        |
| CALL_START               | 'call:start'          | Server -> Both: ICE servers + token payload    |
| SIGNAL_OFFER             | 'signal:offer'        | Bidirectional: WebRTC SDP Offer relay          |
| SIGNAL_ANSWER            | 'signal:answer'       | Bidirectional: WebRTC SDP Answer relay         |
| SIGNAL_ICE               | 'signal:ice'          | Bidirectional: ICE candidate exchange          |
| PRESENCE_AVAILABLE       | 'presence:available'  | Client -> Server: Set user ready for calls     |
| PRESENCE_UNAVAILABLE     | 'presence:unavailable'| Client -> Server: Set user offline             |
| BALANCE_WARNING          | 'balance:warning'     | Server -> Client: 1 minute remaining alert     |
| CALL_FORCE_ENDED         | 'call:force_ended'    | Server -> Client: Balance exhausted drop       |
+--------------------------+-----------------------+------------------------------------------------+
```

---

### C.3 Operating System & Android Manifest Permissions

| Permission Identifier | File & Line | Technical Rationale |
| :--- | :--- | :--- |
| `android.permission.RECORD_AUDIO` | `mobile/app.config.js:22` | **Microphone Hardware Access:** Required by Android OS for capturing microphone input during voice calls. |
| `android.permission.MODIFY_AUDIO_SETTINGS` | `mobile/app.config.js:23` | **Audio Focus Management:** Required by `react-native-incall-manager` to toggle earpiece and speakerphone modes. |
| `android.permission.FOREGROUND_SERVICE` | `mobile/app.config.js:24` | **Background Execution:** Allows audio session to remain connected when user leaves app or turns screen off. |
| `android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK` | `mobile/app.config.js:25` | **Android 14+ Compliance:** Mandatory foreground service sub-type for continuous media playback/recording. |
| `android.permission.WAKE_LOCK` | `mobile/app.config.js:30` | **CPU Keep-Alive:** Prevents Android OS CPU from deep-sleeping during an active voice call. |
| `NSMicrophoneUsageDescription` | `mobile/app.config.js:14` | **iOS App Store Requirement:** Human-readable permission justification prompt shown by iOS when microphone is first accessed. |
| `incoming_calls` Notification Channel | `mobile/src/push/pushService.ts:31` | **Android Notification Framework:** High-priority Android notification channel configured with `IMPORTANCE_MAX` to wake device screen for incoming calls. |

---

### C.4 Database Schema States & Security Invariants

| Invariant Name | Current Value | File & Line | Rationale |
| :--- | :--- | :--- | :--- |
| `User Status Enum` | `'active', 'suspended', 'banned', 'flagged'` | `backend/src/controllers/admin.controller.js:51` | Database integrity constraint on `users.status`. |
| `Call Status Enum` | `'ringing', 'connected', 'ended', 'missed', 'declined'` | `backend/src/controllers/admin.controller.js:73` | State machine enum in `call_sessions.status`. |
| `Report Status Enum` | `'pending', 'reviewed', 'resolved', 'dismissed'` | `backend/src/controllers/admin.controller.js:67` | Moderation queue lifecycle states in `reports.status`. |
| `Admin Password Policy Regex` | `min 12, upper, lower, digit, symbol` | `backend/src/controllers/admin.controller.js:20` | OWASP ASVS Level 2 compliance requirement. Prevents weak administrator credentials. |
| `Bcrypt Salt Work Factor` | `12` rounds | `backend/src/controllers/auth.controller.js:100` | Cryptographic work factor for hashing passwords. Balances brute-force resistance against server CPU utilization. |
| `Token Version Entropy` | `crypto.randomBytes(8)` (64-bit hex) | `backend/src/utils/token.js:44` | Cryptographic entropy for instant invalidation of revoked refresh token families. |
| `Socket Payload Size Limit` | `65536` bytes (64 KB) | `backend/src/config/index.js:77`, `backend/src/socket/socketAbuseGuard.js:45` | Prevents Socket.IO buffer overflow and memory exhaustion DOS attacks. |
| `Socket Ping Timeout / Interval` | `20000ms` / `25000ms` | `backend/src/socket/index.js:65-66` | Engine.IO heartbeat protocol contract. Detects dead client TCP connections within 45 seconds. |

---

## 6. Master Consolidated Inventory

The following master index categorizes every audited configuration, timeout, and setting found across `backend/`, `admin/`, and `mobile/`.

| Item Name | Current Code Value | File & Line | Class | Proposed Key / Placement |
| :--- | :--- | :--- | :---: | :--- |
| Same-Peer Rematch Cooldown | `60` seconds | `matching.service.js:44`, `SettingsPage.jsx:793` | **A** | `cooldown_same_peer_seconds` |
| Ring Timeout Seconds | `30` seconds | `socket/index.js:350`, `CallContext.tsx:144` | **A** | `ring_timeout_seconds` |
| New User Free Trial Mins | `10` minutes | `auth.controller.js:123`, `billing.service.js:37` | **A** | `free_trial_minutes_new_user` |
| Free Daily Minute Cap | `30` minutes | `billing.service.js:62`, `SettingsPage.jsx:25` | **A** | `free_daily_minute_cap` |
| Per Minute Billing Rate | `1.0` INR | `billing.service.js:186`, `SettingsPage.jsx:22` | **A** | `billing_rate_per_minute` |
| Minimum Calling Balance | `5.0` INR | `billing.service.js:49`, `SettingsPage.jsx:23` | **A** | `billing_minimum_balance` |
| Billing Pulse Interval | `60000` ms | `billing.service.js:402` | **A** | `billing_pulse_interval_ms` |
| Auto-Flag Report Count | `3` reports | `user.controller.js:431`, `call.service.js:318` | **A** | `auto_flag_report_threshold` |
| Auto-Suspend Threshold | `3` reports / `24` hrs | `app_settings.moderation_settings` | **A** | `auto_suspend_report_threshold` |
| Availability Inactivity Grace | `60` minutes | `cleanup.service.js:165` | **A** | `availability_grace_period_minutes` |
| Call History Retention | `90` days | `cleanup.service.js:230` | **A** | `call_history_retention_days` |
| Cleanup Service Interval | `5 * 60 * 1000` ms | `cleanup.service.js:288` | **A** | `cleanup_service_interval_ms` |
| Stuck Ringing Timeout | `60` seconds | `cleanup.service.js:96` | **A** | `stuck_ringing_cleanup_seconds` |
| Expired OTP Purge Age | `24` hours | `cleanup.service.js:62` | **A** | `otp_purge_retention_hours` |
| User Password Min Length | `8` characters | `auth.controller.js:33` | **A** | `user_password_min_length` |
| User Access Token TTL | `15` minutes | `token.js:18` | **A** | `user_jwt_access_token_ttl_minutes` |
| User Refresh Token TTL | `7` days | `auth.controller.js:137`, `token.js:48` | **A** | `user_refresh_token_ttl_days` |
| Admin Access Token TTL | `12` hours | `token.js:34` | **A** | `admin_jwt_access_token_ttl_hours` |
| Admin Login Max Attempts | `5` attempts | `admin.controller.js:146` | **A** | `admin_max_login_attempts` |
| Admin Lockout Duration | `15` minutes | `admin.controller.js:146` | **A** | `admin_lockout_duration_minutes` |
| OTP Validity Lifetime | `5` minutes (300s) | `auth.controller.js:322` | **A** | `otp_expiry_seconds` |
| OTP Max Verify Attempts | `3` attempts | `auth.controller.js:322` | **A** | `otp_max_verify_attempts` |
| OTP Resend Cooldown | `60` seconds | `auth.controller.js:290` | **A** | `otp_resend_cooldown_seconds` |
| Socket Disconnect Grace | `5000` ms (5s) | `CallContext.tsx:357` | **A** | `network_disconnect_grace_period_seconds` |
| Max Single Call Length | Indefinite (Uncapped)| Absent | **A** | `max_call_duration_seconds` |
| WebRTC STUN Server URLs | `stun:stun.l.google...`| `config/index.js:41`, `AudioEngine.ts:189` | **A** | `webrtc_stun_urls` |
| WebRTC TURN Server URL | `turn:anoncall-api...`| `config/index.js:43` | **A** | `webrtc_turn_url` |
| WebRTC TURN Token TTL | `3600` seconds | `config/index.js:50` | **A** | `webrtc_turn_credential_ttl_seconds` |
| Push Notification Title | `'Incoming call'` | `push.js:110` | **A** | `push_notification_title` |
| Push Notification Body | `'Someone wants to talk'`| `push.js:111` | **A** | `push_notification_body` |
| Push Receipt Delay | `60000` ms | `push.js:66` | **A** | `push_notification_receipt_delay_ms` |
| Push Notification Channel | `'incoming_calls'` | `push.js:113`, `pushService.ts:31` | **C** | Invariant channel ID on Android |
| Hosted Privacy Policy Link | `https://anonaudiocall...`| `PrivacyPolicyModal.tsx:21` | **A** | `privacy_policy_url` |
| Minimum Legal User Age | `18` years | `RegisterScreen.tsx:64, 157` | **A** | `min_registration_age` |
| Legal Terms & Privacy Ver | `'1.0'` | `auth.controller.js:21`, `SettingsScreen.tsx:106` | **A** | `active_terms_version` / `active_privacy_version` |
| Global HTTP Rate Limit | `300` / 15m | `config/index.js:63`, `rateLimiter.js:26` | **A** | `rate_limit_global_max` |
| Register HTTP Rate Limit | `10` / 15m | `config/index.js:65`, `rateLimiter.js:43` | **A** | `rate_limit_register_max` |
| Login IP HTTP Rate Limit | `10` / 15m | `config/index.js:67`, `rateLimiter.js:60` | **A** | `rate_limit_login_ip_max` |
| Login Account Rate Limit | `5` / 15m | `config/index.js:68`, `rateLimiter.js:77` | **A** | `rate_limit_login_account_max` |
| OTP Request IP Limit | `5` / 15m | `config/index.js:70`, `rateLimiter.js:95` | **A** | `rate_limit_otp_request_max` |
| OTP Request Phone Limit | `3` / 15m | `config/index.js:71`, `rateLimiter.js:112` | **A** | `rate_limit_otp_request_phone_max` |
| Socket Skip/Cancel Count | `5` in 60s | `config/index.js:82`, `socketAbuseGuard.js:52`| **A** | `socket_skip_cancel_threshold` |
| Socket Skip Cooldown | `30000` ms (30s) | `config/index.js:84`, `socketAbuseGuard.js:54`| **A** | `socket_skip_cancel_cooldown_ms` |
| Socket Call Find Limit | `10` / 60s | `config/index.js:78`, `socketAbuseGuard.js:46`| **A** | `socket_rate_limit_call_find_max` |
| Socket Signal Rate Limit | `60` / 60s | `config/index.js:79`, `socketAbuseGuard.js:47`| **A** | `socket_rate_limit_signal_max` |
| Socket Malformed Count | `5` violations | `config/index.js:81`, `socketAbuseGuard.js:51`| **A** | `socket_max_malformed_events` |
| System Maintenance Switch | `false` | Implicitly absent | **A** | `maintenance_mode_enabled` |
| Minimum App Version Gating| `1.0.0` | `app.config.js:5` | **A** | `min_supported_mobile_version` |
| Database Connection URL | `postgresql://...` | `config/index.js:33` | **B** | `.env` (`DATABASE_URL`) |
| User JWT Signing Secret | `>32 chars` | `config/index.js:34` | **B** | `.env` (`JWT_SECRET`) |
| Refresh Token Secret | `>32 chars` | `config/index.js:35` | **B** | `.env` (`JWT_REFRESH_SECRET`) |
| Coturn Shared HMAC Secret| `TURN_SECRET` | `config/index.js:49` | **B** | `.env` (`TURN_SECRET`) |
| Backend Server Port | `3000` | `config/index.js:31` | **B** | `.env` (`PORT`) |
| Backend Bind Host | `'0.0.0.0'` | `config/index.js:30` | **B** | `.env` (`HOST`) |
| Admin CORS Whitelist | `http://localhost:5173...`| `config/index.js:51` | **B** | `.env` (`ADMIN_CORS_ORIGIN`) |
| Mobile API Base URL | `https://anoncall...` | `mobile/src/config/index.ts:6` | **B** | `.env` (`EXPO_PUBLIC_API_URL`) |
| Media Audio Constraints | `{ audio: true }` | `AudioEngine.ts:164` | **C** | Invariant hardware WebRTC constraint |
| Media SDP Offer/Answer | `{ audio: true, video: false }` | `AudioEngine.ts:240, 262` | **C** | Invariant SDP audio-only protocol contract |
| ICE Relay-Only Policy | `'relay'` if TURN | `AudioEngine.ts:190` | **C** | Invariant IP anonymity shield |
| Coturn HMAC Algorithm | `'sha1'` | `config/index.js:256` | **C** | Coturn standard RFC 5766 REST protocol |
| Socket Event Protocol | `'call:find'`, etc. | `backend/socket/index.js:15`, `mobile/socket/index.ts:17` | **C** | Fixed WebSocket wire protocol contracts |
| Android Native Permissions| `RECORD_AUDIO`, etc. | `mobile/app.config.js:21-32` | **C** | Operating system security sandbox declarations |
| Bcrypt Salt Work Factor | `12` rounds | `auth.controller.js:100` | **C** | Fixed cryptographic algorithm parameter |
| Admin Password Complexity | 12 chars, upper/lower/num/sym | `admin.controller.js:20` | **C** | Fixed administrative security rule |

---

## 7. Actionable Implementation Blueprint for Admin Management

To transition all Group A settings from static files, SQL intervals, and `.env` variables into a unified, dynamic administration system without degrading performance:

### 1. Database Schema Consolidation
Unify fragmented settings rows into clear namespaces within `app_settings`:
*   `system_settings`: Maintenance switch, app version gating, support and store links.
*   `auth_settings`: Login toggles, password length, token lifetimes, OTP parameters.
*   `matching_settings`: Rematch cooldown, presence priority, retry counts, ring timeouts.
*   `monetization`: Mode, currency, per-minute rate, free trial, daily cap, pulse interval.
*   `moderation_settings`: Flag report threshold, auto-suspend rules, report note max length.
*   `retention`: Grace period, data retention days, background janitor interval.
*   `traffic_limits`: REST rate limits, Socket rate limits, skip/cancel thresholds.
*   `legal_compliance`: Active terms version, privacy policy URL, age requirements.

### 2. In-Memory Cache with Immediate Invalidation
Querying `app_settings` on every single socket event or HTTP request would create unnecessary database latency.
*   Implement an in-memory `SettingsCache` in `backend/src/services/settings.service.js`.
*   Cache all settings keys in memory with a fast lookup time (0ms).
*   When an administrator submits an update via `PUT /admin/settings/:key`, execute the database update and immediately call `SettingsCache.invalidate(key)`.
*   In multi-instance production environments, emit a Redis Pub/Sub message or PostgreSQL `LISTEN/NOTIFY` event (`NOTIFY settings_updated, 'matching_settings'`) so all server nodes invalidate their caches simultaneously.

### 3. Public Settings Bootstrap Endpoint
Expose non-sensitive public settings to the mobile app via a public endpoint:
*   `GET /api/v1/config/public` (Cached with `Cache-Control: public, max-age=60`).
*   Returns only public keys: `maintenance_mode_enabled`, `min_supported_mobile_version`, `ring_timeout_seconds`, `privacy_policy_url`, `monetization_mode`, `currency`, `active_terms_version`, etc.
*   Mobile client invokes this during the splash screen to check maintenance status and version gating before initializing authentication or socket connections.
