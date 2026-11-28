# Anonymous Audio Calling App - Admin Console

A lightweight, modern React 18 + Vite administrative dashboard for the Anonymous Audio Calling platform. Designed with zero paid UI libraries, pure CSS variables, responsive layout for laptop screens, and strict user privacy and anonymity guarantees.

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **Backend API**: The backend Express server must be running (default `http://localhost:3000`).

### 2. Environment Configuration
Copy `.env.example` to `.env` in the `admin/` directory:
```bash
# In admin/ directory:
cp .env.example .env
```

Default configuration:
```env
VITE_API_URL=http://localhost:3000
```

### 3. Installation
Install frontend dependencies:
```bash
npm install
```

### 4. Running the Development Server
Launch the Vite development server:
```bash
npm run dev
```
The console will be accessible at: **`http://localhost:5173`**

### 5. Production Build
Compile optimized production assets:
```bash
npm run build
```
Preview the production build locally:
```bash
npm run preview
```

---

## 🔐 Admin Authentication & Credentials

Admin login requires authorized administrator credentials configured in the backend database.

- **Default Seed Email:** `admin@yupmail.com` (or `ADMIN_EMAIL` from `backend/.env`)
- **Default Seed Password:** `Admin@123` (or `ADMIN_PASSWORD` from `backend/.env`)
- **TOTP MFA:** Optional 6-digit verification code.

### Security Highlights
- **In-Memory Token Storage:** JWT access tokens are held strictly in JavaScript application memory. Tokens are never written to `localStorage`, `sessionStorage`, cookies, or URL query parameters.
- **Auto 401 Interceptor:** If an admin token expires or is revoked, the API client automatically purges in-memory credentials and redirects the administrator to `/login`.
- **CORS Protection:** Express backend explicitly allows requests from `ADMIN_CORS_ORIGIN` (`http://localhost:5173`) while rejecting unauthorized origins.

---

## 🖥️ Screen & Module Overview

| Module | Route | Key Capabilities |
| :--- | :--- | :--- |
| **Login** | `/login` | Secure administrator authentication with email, password, and optional TOTP MFA. |
| **Dashboard** | `/` | Real-time platform KPI metrics: total registered users, users available now (live indicator), calls today, average call duration, and revenue (when paid mode is active). Includes real-time sockets and safety alerts. |
| **Settings** | `/settings` | Central platform settings registry organized into dynamic tabs: **System**, **Auth & OTP**, **Matching & Calls**, **Billing**, **Moderation**, **Limits**, **Retention**, **Legal & Text**, plus an **Audit History** tab. Features client-side validation, sticky unsaved changes bar, per-key result reporting, critical change confirmation modals, non-blocking amber warnings, cooldown quick presets, SMS provider verification, subscription plan table editor, and immutable audit logs. |
| **Users** | `/users` | Searchable, paginated user accounts table. Displays live availability status (`Available` green dot vs `Offline` gray dot), reports count, wallet balances, and administrative **Ban** / **Unban** actions. |
| **Reports** | `/reports` | Abuse moderation queue filterable by status (`pending`, `reviewed`, `resolved`, `dismissed`). Review complaint reasons, user notes, and perform **Mark Reviewed** or **Ban User** enforcement. |
| **Call Logs** | `/call-logs` | Historical call session records with date/time, duration, end reason, and anonymous session IDs. **Strict privacy:** No audio files exist and no user identities are exposed. |

---

## ⚙️ Platform Settings Management

The settings system connects to the unified Settings Registry API (`/admin/settings`, `/admin/settings/:key`, `/admin/settings/history`, `/admin/settings/status`):

### 1. Dynamic Tabs & Groups
Settings returned from `GET /admin/settings` are automatically partitioned into tabbed views by `group`:
- **System**: Maintenance mode, maintenance banner copy, minimum mobile SemVer (`1.0.0`), and store update URL.
- **Auth & OTP**: User registration toggle, email/password login toggle, mobile SMS OTP toggle (with telephony provider status check), password length, and OTP expiry/attempt parameters.
- **Matching & Calls**: Same-peer rematch cooldown (with quick presets `0`, `30s`, `60s`, `5 min`, `30 min` and amber warning for > 1 hour), ring timeout, max match attempts, live presence preference, max call duration, network disconnect grace period, and trial minute limits.
- **Billing**: Platform currency (`INR (fixed)` read-only indicator), monetization mode (`free`, `subscription`, `per_minute`), per-minute rate and minimum balance (dimmed when mode != per_minute), and subscription packages table editor (dimmed when mode != subscription).
- **Moderation**: Auto-flag and auto-suspend thresholds, lookback windows, suspension duration, and automated spam report filtering.
- **Limits**: Authentication, API, matching, abuse reporting, and WebSocket rate limits and malformed event caps.
- **Retention**: User availability grace period and call session history retention.
- **Legal & Text**: Minimum registration age (`18 (fixed by policy)` read-only indicator), terms of service and privacy policy URLs, version strings, and push notification copy.
- **Audit History**: Paginated, filterable table of historical configuration changes formatted in `Asia/Kolkata` (`IST`), recording admin email, setting key, old/new diffs, and IP addresses.
- **Future Groups**: Any unknown future groups returned by the API automatically render as extra tabs before History.

### 2. Safeguards & UX Features
- **Client & Server Validation**: Real-time validation against min/max/type metadata from the API. Detailed server error messages are rendered inline next to failed fields.
- **Sticky Unsaved Changes Bar**: Displays count of modified settings, with "Save All" and "Discard" actions and browser leave (`beforeunload`) warnings.
- **Critical Changes Modal**: Prompts for confirmation with previous vs. proposed values before applying sensitive changes (e.g. maintenance mode, monetization mode, forced client updates, disabling user registration, or reducing rate limits by > 50%).
- **Reset to Factory Default**: Each setting has a dedicated Reset action calling `DELETE /admin/settings/:key` (disabled when already at default value).
- **Zero Raw HTML Injection**: All inputs and diffs are rendered with standard JSX to prevent XSS. Secrets and API keys are never exposed in settings payloads.

---

## 💻 Laptop Screen Usability
The layout incorporates responsive media queries (`@media (max-width: 1440px)`, `@media (max-width: 1200px)`, `@media (max-width: 1024px)`, and vertical height `@media (max-height: 820px)`) ensuring smooth navigation on 1366x768 and 1920x1080 laptop viewports:
- Compact sidebar (`--sidebar-width: 220px`) and responsive content padding.
- Adaptive KPI and mode selector grids that prevent content truncation.
- Horizontally scrollable data tables (`.table-wrapper`) with sticky headers.
- Max-height constrained modal dialogs with internal scrollbars so action buttons are never pushed off screen.
- Loading skeletons, empty state illustrations with filter-reset buttons, and error retry handlers across all views.
