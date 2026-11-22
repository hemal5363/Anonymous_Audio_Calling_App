# Anonymous Audio Calling App - Security Review Report

**Date:** November 22, 2026  
**Scope:** `backend/`, `admin/`, `mobile/`  
**Reviewers:** Antigravity Security Audit Team  
**Status:** Remediated & Verified (All High, Medium, and Low actionable findings resolved; dependencies documented with accepted risk analysis)

---

## 1. Executive Summary

A comprehensive security assessment was conducted across the **backend** (Node.js/Express/Socket.io), **admin** (React/Vite), and **mobile** (React Native/Expo) codebases. The objective was to evaluate the application's resilience against unauthorized access, privilege escalation, data leakage, denial-of-service, and compromise of user anonymity.

### Overall Assessment & Remediation Results
The architecture demonstrates solid security fundamentals:
- **Zero user identity exposure** over WebRTC signaling and peer socket events, upholding the core anonymity requirement.
- Strict token isolation between **regular users** and **admin accounts** (`authenticateUser` vs. `authenticateAdmin`).
- Complete adoption of **parameterized SQL queries** (`$1`, `$2`), eliminating SQL injection vulnerabilities in application endpoints.
- In-memory token management in the Admin portal, avoiding persistent storage of privileged tokens in `localStorage`.
- Device-level credential storage using `expo-secure-store` in the mobile client.

All identified High, Medium, and Low code findings have been systematically resolved and verified with automated test suites (**183 passing tests across 14 test suites in the backend** and **zero TypeScript errors in the mobile app**).

---

## 2. Summary of Findings & Resolution Status

| ID | Category | Severity | File & Line | Summary | Status |
|---|---|---|---|---|---|
| **SEC-01** | Auth | **HIGH** | `backend/src/config/index.js:13-14` | Minimum length check (>= 32 chars) for `JWT_SECRET` and `JWT_REFRESH_SECRET`. | **FIXED** |
| **SEC-02** | OTP | **HIGH** | `backend/src/controllers/auth.controller.js:285` | Insecure PRNG (`Math.random()`) used to generate 6-digit OTP codes. | **FIXED** |
| **SEC-03** | OTP | **HIGH** | `backend/src/controllers/auth.controller.js:308-312` | Plaintext OTP logged to server output without environment check. | **FIXED** |
| **SEC-04** | Auth | **HIGH** | `backend/src/controllers/admin.controller.js:275-300`, `backend/src/socket/index.js:432-464` | Banned/suspended users maintain active socket connections and mid-call signaling. | **FIXED** |
| **SEC-05** | Dependencies | **HIGH** | `backend/package.json`, `admin/package.json` | High & Critical dependency vulnerabilities (`tar`, `zod`, `react-router`, `esbuild`). | **ACCEPTED RISK** |
| **SEC-06** | OTP | **MEDIUM** | `backend/src/controllers/auth.controller.js:260-320` | Missing per-phone number cooldown rate limiting on OTP generation. | **FIXED** |
| **SEC-07** | Secrets | **MEDIUM** | `backend/src/db/seed.js:17` | Fallback default admin password (`AdminPassword123!`) if `ADMIN_PASSWORD` is unset. | **FIXED** |
| **SEC-08** | Secrets | **MEDIUM** | `.gitignore:1-5` | Root `.gitignore` missing exclusion patterns for keys, certificates, and credentials. | **FIXED** |
| **SEC-09** | Transport | **MEDIUM** | `backend/src/app.js:16-20` | Missing HTTPS redirection and reverse proxy trust configuration in production. | **FIXED** |
| **SEC-10** | Validation | **MEDIUM** | `backend/src/socket/index.js:154-156, 222-225` | Absence of schema validation on incoming socket event payloads. | **FIXED** |
| **SEC-11** | Auth | **LOW** | `backend/src/controllers/auth.controller.js:98`, `backend/src/db/seed.js:22` | Password hashing work factor set to 10 salt rounds instead of OWASP recommended 12. | **FIXED** |
| **SEC-12** | Auth | **LOW** | `backend/src/controllers/auth.controller.js:611-615` | Logout refresh token revocation lacks user ID ownership scoping in SQL query. | **FIXED** |
| **SEC-13** | Validation | **LOW** | `backend/src/controllers/admin.controller.js:188-193, 311-315, 508-512` | Unvalidated pagination and query parameters on admin listing routes. | **FIXED** |
| **SEC-14** | Client Security | **MEDIUM** | `mobile/src/auth/tokenStorage.ts`, `mobile/babel.config.js` | Mobile token storage restricted to `expo-secure-store`; production release console log stripping. | **FIXED** |
| **SEC-15** | Admin Auth | **MEDIUM** | `admin/src/api/client.js`, `admin/src/auth/AuthContext.jsx` | Admin token stored strictly in-memory (no localStorage); 401 token expiry auto-logout. | **FIXED** |
| **SEC-16** | Admin Auth | **MEDIUM** | `backend/src/controllers/admin.controller.js`, `admin/src/pages/SettingsPage.jsx` | Strong admin password policy enforcement (>= 12 chars, upper, lower, digit, symbol). | **FIXED** |
| **SEC-17** | Privacy & XSS | **LOW** | `admin/src/pages/*`, `docs/PRIVACY_POLICY.md` | Admin UI output escaping verified; Google Play Privacy Policy and in-app links added. | **FIXED** |

---

## 3. Detailed Findings, Remediation & Verification

### 3.1 Authentication & Session Management

#### [SEC-01] Missing Minimum Length Requirement on JWT Secrets
- **Severity:** High
- **Status:** **FIXED**
- **File & Line:** `backend/src/config/index.js:13-14`
- **Risk:**
  `JWT_SECRET` and `JWT_REFRESH_SECRET` were validated with `z.string().min(1)`. Short HMAC secrets can be cracked offline in seconds using dictionary attacks, allowing an attacker to forge arbitrary JWTs and bypass authentication.
- **Remediation Applied:**
  Updated `backend/src/config/index.js` to enforce minimum 32 characters on both secrets using Zod:
  ```javascript
  JWT_SECRET: z.string().min(32, 'JWT_SECRET is required and must be at least 32 characters long'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET is required and must be at least 32 characters long'),
  ```
  The server refuses to boot if secrets are missing or shorter than 32 characters.
- **Verification Test:** `tests/security_audit_fixes.test.js` (`SEC-01: JWT Secret Minimum Length Requirements`).

---

#### [SEC-04] Banned Users Not Disconnected or Revoked in Real Time
- **Severity:** High
- **Status:** **FIXED**
- **File & Line:** `backend/src/controllers/admin.controller.js:275-300`, `backend/src/socket/index.js:432-464`
- **Risk:**
  When an admin changed a user's status to `banned` or `suspended`, the user's active socket connection remained connected and in-call signaling continued until the user manually hung up.
- **Remediation Applied:**
  In `updateUserStatus` (`backend/src/controllers/admin.controller.js`):
  1. Revokes all active refresh tokens in `refresh_tokens` table for the user.
  2. If the user is currently in a call, calls `endCall` in `callSessionManager` with `reason: 'user_banned'` and broadcasts `call:ended` to the call room.
  3. Emits `auth:revoked` event to the user's socket and forcibly disconnects it via `userSocket.disconnect(true)`.
  4. Removes the user from `userSocketMap`.
- **Verification Test:** `tests/security_audit_fixes.test.js` (`SEC-04: Real-time Banned/Suspended User Revocation`).

---

#### [SEC-11] Password Hashing Cost Below OWASP Recommendation
- **Severity:** Low
- **Status:** **FIXED**
- **File & Line:** `backend/src/controllers/auth.controller.js:98`, `backend/src/db/seed.js:22`
- **Risk:**
  Password hashing used 10 salt rounds. OWASP password storage guidelines recommend 12 rounds for general production authentication to increase resistance against offline GPU/ASIC hash cracking.
- **Remediation Applied:**
  Increased bcrypt work factor to 12 rounds in `auth.controller.js` and `seed.js`:
  ```javascript
  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);
  ```
- **Verification Test:** `tests/security_audit_fixes.test.js` (`SEC-11: Password Hashing Cost (12 Rounds)`).

---

#### [SEC-12] Logout Token Revocation Query Not Scoped by User ID
- **Severity:** Low
- **Status:** **FIXED**
- **File & Line:** `backend/src/controllers/auth.controller.js:611-615`
- **Risk:**
  During logout, refresh tokens were updated by `token_hash = $1` without constraining `AND user_id = $2`.
- **Remediation Applied:**
  Scoped the database update in `backend/src/controllers/auth.controller.js`:
  ```javascript
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND user_id = $2',
    [tokenHash, req.user.id]
  );
  ```
- **Verification Test:** `tests/security_audit_fixes.test.js` (`SEC-12: Logout Token Revocation Scoped by User ID`).

---

### 3.2 One-Time Passcode (OTP) Security

#### [SEC-02] Insecure Pseudo-Random Number Generator for OTP Generation
- **Severity:** High
- **Status:** **FIXED**
- **File & Line:** `backend/src/controllers/auth.controller.js:285`
- **Risk:**
  `Math.random()` uses V8's xorshift128+ PRNG, which is cryptographically insecure and reversible. An attacker could predict upcoming OTP codes.
- **Remediation Applied:**
  Replaced `Math.random()` with `crypto.randomInt(100000, 1000000).toString()` using Node's built-in cryptographic library.
- **Verification Test:** `tests/security_audit_fixes.test.js` (`SEC-02: should generate 6-digit OTP using crypto.randomInt`).

---

#### [SEC-03] Plaintext OTP Leaked in Application Logs
- **Severity:** High
- **Status:** **FIXED**
- **File & Line:** `backend/src/controllers/auth.controller.js:308-312`
- **Risk:**
  Plaintext OTPs were logged at `info` level regardless of environment, leaking passcodes to centralized log aggregators in production.
- **Remediation Applied:**
  Gated the console output strictly behind `if (config.env !== 'production')` in `requestOtp`. In production environments, OTP codes are never logged to console or files.
- **Verification Test:** `tests/security_audit_fixes.test.js` (`SEC-03: should NOT log plaintext OTP in production environment`).

---

#### [SEC-06] Missing Per-Target Cooldown on OTP Requests
- **Severity:** Medium
- **Status:** **FIXED**
- **File & Line:** `backend/src/controllers/auth.controller.js:260-320`
- **Risk:**
  Rate limiting was purely IP-based. An attacker with rotating IPs could spam SMS codes to a target victim's phone number.
- **Remediation Applied:**
  Added a database check before generating a new OTP:
  ```javascript
  const recentOtp = await pool.query(
    `SELECT id FROM otp_codes 
     WHERE target = $1 AND purpose = 'login' AND created_at > CURRENT_TIMESTAMP - INTERVAL '60 seconds' 
     LIMIT 1;`,
    [phone]
  );
  if (recentOtp.rows.length > 0) {
    return res.status(429).json({
      statusCode: 429,
      error: 'TooManyRequests',
      message: 'Please wait 60 seconds before requesting another code',
    });
  }
  ```
- **Verification Test:** `tests/security_audit_fixes.test.js` (`SEC-06: should return 429 Too Many Requests if OTP was requested within 60 seconds`).

---

### 3.3 Authorization & Access Control (IDOR)

#### Verified Controls:
- **Admin vs User Separation:** Admin routes (`/admin/*`) require `authenticateAdmin` checking `decoded.type === 'admin'` and verifying the `admin_users` table. User tokens cannot satisfy this check.
- **User Resource Ownership:** REST endpoints (`/user/*`, `/billing/*`, `/calls/history`) strictly scope queries using `req.user.id`.
- **Call Session Authorization:** `/calls/session/:sessionId` and `call:session:state` enforce caller/callee participation (403 Forbidden on mismatch).
- **WebRTC Signaling Relay:** `signal:offer`, `signal:answer`, `signal:ice` verify `callSessionManager.isParticipant(callCode, socket.userId)`.

---

### 3.4 Input Validation & SQL Injection

#### [SEC-10] Unvalidated Socket Event Payloads
- **Severity:** Medium
- **Status:** **FIXED**
- **File & Line:** `backend/src/socket/index.js:154-156, 222-225`
- **Risk:**
  Socket handlers parsed incoming payloads without validating types, shapes, or string bounds.
- **Remediation Applied:**
  Added defensive payload validation across socket handlers (`handleRelay`, `call:accept`, `call:end`, `call:session:state`, `call:mute`):
  - Validates that payloads are objects.
  - Enforces string type and length constraints on `callCode` (<= 100 chars), `sessionId` (<= 100 chars), and `reason` (<= 50 chars).
  - Emits `call:error` or acknowledges with errors when payloads are invalid.
- **Verification Test:** `tests/socket.test.js` (`SEC-10: Socket Event Payload Validation`).

---

#### [SEC-13] Unvalidated Query Parameters on Admin Endpoints
- **Severity:** Low
- **Status:** **FIXED**
- **File & Line:** `backend/src/controllers/admin.controller.js:188-193, 311-315, 508-512`
- **Risk:**
  Admin listing endpoints (`/admin/users`, `/admin/reports`, `/admin/calls`) did not validate `status` against allowed enums.
- **Remediation Applied:**
  Introduced Zod schemas (`listUsersQuerySchema`, `listReportsQuerySchema`, `listCallLogsQuerySchema`) enforcing enum checks and positive integer pagination (`page >= 1`, `1 <= limit <= 100`). Invalid parameters return 400 Bad Request.
- **Verification Test:** `tests/security_audit_fixes.test.js` (`SEC-13: Admin Query Parameter Validation`).

---

### 3.5 Privacy & Anonymity

#### Verified Controls:
- **Anonymity Across WebRTC Signaling:** All call initiation events (`call:matched`, `call:ringing`, `call:incoming`, `call:ended`) pass only `{ sessionId, callCode, iceServers, isCaller }`. No user names, IDs, numbers, or emails are exposed.
- **Push Notification Payloads:** Payloads sent via `backend/src/services/push.js` contain only `{ type: "incoming_call", sessionId }` with title `"Incoming call"` and body `"Someone wants to talk"`.
- **Call History Anonymity:** `/calls/history` returns timestamps, durations, and statuses, omitting peer user IDs.
- **WebRTC IP Privacy:** SDP descriptions and ICE candidates are not logged in production builds (`mobile/src/call/AudioEngine.ts`).

---

### 3.6 Secrets & Configuration Management

#### [SEC-07] Hardcoded Fallback Password in Database Seed Script
- **Severity:** Medium
- **Status:** **FIXED**
- **File & Line:** `backend/src/db/seed.js:17`
- **Risk:**
  Running `npm run seed` in production without setting `ADMIN_PASSWORD` would seed a known default password (`AdminPassword123!`).
- **Remediation Applied:**
  In `backend/src/db/seed.js`, added a strict check refusing to execute in production if `ADMIN_PASSWORD` is unset:
  ```javascript
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD must be explicitly set in environment variables when seeding in production');
  }
  ```
- **Verification Test:** `tests/security_audit_fixes.test.js` (`SEC-07: Seed Script Protection in Production`).

---

#### [SEC-08] Incomplete Root `.gitignore` Patterns
- **Severity:** Medium
- **Status:** **FIXED**
- **File & Line:** `.gitignore:1-5`
- **Risk:**
  The root `.gitignore` did not exclude certificate keys, PEM files, or Google services credentials placed at the repo root.
- **Remediation Applied:**
  Added exclusion patterns to `.gitignore`:
  ```gitignore
  # Credentials, secrets and keys
  secrets/
  *.pem
  *.key
  *.jks
  *.p12
  *.p8
  *.mobileprovision
  google-services.json
  *-firebase-adminsdk-*.json
  ```
- **Verification:** Verified tracked file list with `git status`.

---

### 3.7 Network Transport & Header Security

#### [SEC-09] Missing HTTPS Redirection & Reverse Proxy Trust in Production
- **Severity:** Medium
- **Status:** **FIXED**
- **File & Line:** `backend/src/app.js:16-20`
- **Risk:**
  When deployed behind an AWS ALB or reverse proxy, unencrypted HTTP requests could be accepted, exposing JWT tokens over cleartext networks.
- **Remediation Applied:**
  In `backend/src/app.js`:
  1. Configured `app.set('trust proxy', 1);` (trusting the first reverse proxy hop, complying with `express-rate-limit` recommendations).
  2. Added middleware that redirects insecure HTTP requests to HTTPS with HTTP 301 in production when `x-forwarded-proto !== 'https'`.
- **Verification Test:** `tests/security_audit_fixes.test.js` (`SEC-09: Production HTTPS Redirection & Trust Proxy`).

---

### 3.8 Third-Party Dependency Vulnerabilities (`npm audit`)

#### [SEC-05] Dependency Audit Findings & Risk Analysis
- **Severity:** High
- **Status:** **ACCEPTED RISK WITH REASON**
- **Scope:** `backend/package.json`, `admin/package.json`

#### Risk Evaluation & Rationale:

1. **`tar <=7.5.20` in `backend/` (via `bcrypt` -> `@mapbox/node-pre-gyp`):**
   - **Reason for Acceptance:** `tar` is a build-time dependency packaged inside `@mapbox/node-pre-gyp` used only during native binary compilation when installing `bcrypt`. It is **never executed at runtime** by the Express or Socket.io server. The application does not accept, parse, or decompress tar archives from users.
   - **Mitigation:** Production container builds use pre-built binaries and install scripts in an isolated build phase.

2. **`zod <4.6.6` in `backend/`:**
   - **Reason for Acceptance:** The reported advisory (GHSA-mrhx-c7xc-m3w5) is a DoS vulnerability occurring during validation of oversized constrained sets (`z.set()`) and maps (`z.map()`). The application uses Zod exclusively for scalar strings, numbers, booleans, and enums, and does not use `z.set()` or `z.map()`. Upgrading to `zod@4.6.7` requires `--force` and introduces major breaking changes to the Zod v3 API.

3. **`esbuild <=0.24.2` via `vite` in `admin/`:**
   - **Reason for Acceptance:** `esbuild` is a local development dependency used by Vite during local development bundling. It is **not included in the production web build** (which outputs static HTML/CSS/JS in `dist/`). Upgrading requires Vite 8 (breaking change).

4. **`react-router` / `react-router-dom` in `admin/`:**
   - **Reason for Acceptance:** The high-severity advisory (GHSA-337j-9hxr-rhxg) involves SSR hydration via `deserializeErrors()`. The Admin application is a **pure client-side Single Page Application (SPA)** with zero SSR hydration. The moderate advisory involves open redirects in `<Link>` when navigating to user-provided URLs; the Admin portal only navigates to static internal route paths. Upgrading to React Router v7 is a major breaking rewrite.

---

### 3.9 Mobile Client Hardening & Token Security

#### [SEC-14] Mobile Token Storage, Release Console Stripping & Expired Session Handling
- **Severity:** Medium
- **Status:** **FIXED**
- **Files:** `mobile/src/auth/tokenStorage.ts`, `mobile/babel.config.js`, `mobile/metro.config.js`, `mobile/src/api/client.ts`, `mobile/src/socket/index.ts`
- **Remediation Applied:**
  1. **Hardware-Backed Token Storage:** Tokens are exclusively stored via `expo-secure-store` on Android/iOS (backed by Android Keystore and iOS Keychain). Unencrypted `AsyncStorage` and browser `localStorage` fallbacks were eliminated entirely.
  2. **Zero Sensitive Data in Logs:** No user identities, tokens, OTPs, or phone numbers are output to console logs.
  3. **Release Build Console Stripping:** Production release builds strip all `console.log`, `info`, and `debug` calls via `babel-plugin-transform-remove-console` in `mobile/babel.config.js` and `drop_console: true` in `mobile/metro.config.js`.
  4. **Clear Expired Session Handling:** REST 401 refresh failure and WebSocket auth error (`jwt expired`, `Unauthorized`, `banned`) trigger `handleSessionExpired()`, which clears `expo-secure-store`, resets `AuthContext`, and navigates the user back to `Login`.
  5. **Permission-Denied Handling:** Microphone denial displays explicit advisory alerts without crashing or hanging; notification denial shows an amber recommendation banner on Home without blocking app usage.

---

### 3.10 Admin Web Dashboard & Privilege Protection

#### [SEC-15] Admin In-Memory Token Storage & Token Expiry Auto-Logout
- **Severity:** Medium
- **Status:** **FIXED**
- **Files:** `admin/src/api/client.js`, `admin/src/auth/AuthContext.jsx`, `admin/src/components/ProtectedRoute.jsx`
- **Remediation Applied:**
  1. **In-Memory Token Management:** The Admin portal retains JWT access tokens strictly in JavaScript memory (`_inMemoryToken` property in `ApiClient` and React state in `AuthContext`). Tokens are never persisted in `localStorage`, `sessionStorage`, cookies, or URL query parameters, preventing persistent cross-site script token theft.
  2. **Automatic 401 Interceptor Logout:** When any admin API request receives a 401 Unauthorized (e.g. token expired or revoked), `ApiClient` clears the in-memory token and fires subscriber callbacks to reset `AuthContext`, immediately redirecting the administrator to `/login`.

#### [SEC-16] Strong Admin Password Policy Enforcement
- **Severity:** Medium
- **Status:** **FIXED**
- **Files:** `backend/src/controllers/admin.controller.js`, `backend/src/routes/admin.routes.js`, `admin/src/pages/SettingsPage.jsx`
- **Remediation Applied:**
  1. **Backend Validation:** Implemented `PATCH /admin/auth/password` with Zod validation enforcing: minimum 12 characters, uppercase letter, lowercase letter, number, and special character (`[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]`), hashed with bcrypt (12 salt rounds).
  2. **Admin Dashboard UI:** Added an interactive "Administrator Security & Password Policy" section in `admin/src/pages/SettingsPage.jsx` with a real-time policy checklist.
- **Verification Test:** `tests/admin_auth.test.js` (`PATCH /admin/auth/password (Strong Admin Password Policy)`).

#### [SEC-17] UI Output Escaping & Google Play Privacy Policy
- **Severity:** Low
- **Status:** **FIXED**
- **Files:** `admin/src/pages/*`, `docs/PRIVACY_POLICY.md`, `mobile/src/components/PrivacyPolicyModal.tsx`
- **Remediation Applied:**
  1. **XSS Protection:** Verified zero occurrences of `dangerouslySetInnerHTML`, `innerHTML`, or unsafe DOM manipulation across all admin pages. All dynamic values (emails, phones, report notes, session IDs) render through React DOM text node escaping.
  2. **Privacy Policy:** Authored `docs/PRIVACY_POLICY.md` documenting exact data collection (email, phone, call metadata, push token) and explicitly stating **no audio is ever recorded or stored** (WebRTC P2P direct audio stream).
  3. **In-App Policy Links:** Integrated `PrivacyPolicyModal` across mobile `LoginScreen`, `RegisterScreen`, and `SettingsScreen` satisfying Google Play Store compliance.

---

## 4. Verification Summary

All fixes have been validated using automated test runners across the entire codebase:

1. **Backend Integration & Unit Tests:**
   - Command: `npm test --prefix backend`
   - Result: **14 test suites passed, 183 tests passed (100% success rate)**
   - Included: `security_audit_fixes.test.js`, `socket.test.js`, `auth.test.js`, `admin_auth.test.js`, `push.test.js`, `billing.test.js`, `matching.test.js`, `call_lifecycle.test.js`, `ice_servers.test.js`, `mobile_login_setting.test.js`.

2. **Admin Web App Build:**
   - Command: `npm run --prefix admin build`
   - Result: **Vite build successful with 0 errors**.

3. **Mobile Client Type Verification:**
   - Command: `mobile/node_modules/.bin/tsc --noEmit --project mobile/tsconfig.json`
   - Result: **0 TypeScript errors**.
