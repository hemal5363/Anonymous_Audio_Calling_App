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
| **Settings** | `/settings` | Global monetization selector (**Free**, **Subscription**, **Per-minute**). Renders only fields relevant to active mode. Mobile SMS OTP login toggle with telephony gateway cost notice. Confirmation modal on monetization model change. |
| **Users** | `/users` | Searchable, paginated user accounts table. Displays live availability status (`Available` green dot vs `Offline` gray dot), reports count, wallet balances, and administrative **Ban** / **Unban** actions. |
| **Reports** | `/reports` | Abuse moderation queue filterable by status (`pending`, `reviewed`, `resolved`, `dismissed`). Review complaint reasons, user notes, and perform **Mark Reviewed** or **Ban User** enforcement. |
| **Call Logs** | `/call-logs` | Historical call session records with date/time, duration, end reason, and anonymous session IDs. **Strict privacy:** No audio files exist and no user identities are exposed. |

---

## 💻 Laptop Screen Usability
The layout incorporates responsive media queries (`@media (max-width: 1440px)`, `@media (max-width: 1200px)`, `@media (max-width: 1024px)`, and vertical height `@media (max-height: 820px)`) ensuring smooth navigation on 1366x768 and 1920x1080 laptop viewports:
- Compact sidebar (`--sidebar-width: 220px`) and responsive content padding.
- Adaptive KPI and mode selector grids that prevent content truncation.
- Horizontally scrollable data tables (`.table-wrapper`) with sticky headers.
- Max-height constrained modal dialogs with internal scrollbars so action buttons are never pushed off screen.
- Loading skeletons, empty state illustrations with filter-reset buttons, and error retry handlers across all views.
