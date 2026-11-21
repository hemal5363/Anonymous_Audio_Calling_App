# Screen Architecture & Wireframe Specifications

**Target:** Anonymous Audio Calling App (MVP)  
**Document:** `docs/SCREENS.md`  
**Platforms:** React Native (Android MVP) & React Admin Web Panel (Vite)  
**Related Specs:** `docs/CALL_FLOW.md`, `docs/API_SPEC.md`, `docs/DB_SCHEMA.md`  

---

## 1. Universal Design & Privacy Rules

1. **Strict Peer Anonymity:** Mobile screens **never** display the name, phone number, email, avatar image, or user ID of the other user. Peers are only ever designated as *"Anonymous Caller"* or *"Anonymous User"*.
2. **Predictable Availability:** The "Available" switch is prominent, clearly explained, and defaults to `OFF` for new accounts.
3. **Safety First:** Mute, Speaker, End, Skip, Report, and Block are reachable within 1-2 taps on any active or completed call.
4. **Simple MVP Scope:** No complex nested menus, video feeds, social profiles, or chat interfaces.

---

## 2. Mobile App Screens (React Native / Android)

### Overview of Mobile Navigation Hierarchy

```
[ Root Stack ]
  ├── SplashScreen (App init, public config check)
  ├── AuthStack
  │     ├── AuthScreen (Login / Register - Email & optional Mobile OTP)
  │     └── OtpVerifyScreen (6-digit code verification)
  └── MainStack
        ├── HomeScreen (Main dashboard: Call button, Available switch)
        ├── BackgroundHelpModal (One-time push/battery guidance)
        ├── SearchingScreen (Pulsing radar animation while matching)
        ├── IncomingCallScreen (Full-screen alert for incoming call)
        ├── InCallScreen (Active WebRTC voice session)
        ├── PostCallScreen (Duration summary, Report & Block actions)
        ├── WalletScreen (Balance, subscription status, plan cards)
        ├── CallHistoryScreen (Past anonymous calls & durations)
        ├── BlockedUsersScreen (Manage blocked peers)
        └── SettingsScreen (Account controls, terms, logout, delete)
```

---

### 2.1 Splash & Init Screen (`SplashScreen`)
- **Purpose:** Boots the application, fetches public configuration (`GET /config/public`), checks stored JWT access/refresh tokens, and directs to either the authenticated Home screen or Auth flow.
- **Visual Elements:**
  - Minimalist app logo and centered title (*"Anonymous Audio"*).
  - Version label (`v1.0.0-mvp`).
  - Subtle loading spinner.
  - Offline retry banner (if network connection fails).
- **User Actions:**
  - None (automatic transition).
  - Tap "Retry" if initial network config fails.
- **Navigation:**
  - $\rightarrow$ `HomeScreen` (if stored refresh token is successfully validated).
  - $\rightarrow$ `AuthScreen` (if unauthenticated or token revoked).

---

### 2.2 Login & Register Screen (`AuthScreen`)
- **Purpose:** Allows new users to register and returning users to sign in via Email/Password or Mobile OTP (if enabled by admin).
- **Visual Elements:**
  - Header: App logo with tagline (*"Talk freely with strangers"*).
  - Mode Switcher Tab: **Sign In** | **Create Account**.
  - Method Tabs (only visible if `mobile_login_enabled` is `true` in config): **Email** | **Phone**.
  - Form Fields:
    - Email / Phone input.
    - Password input with show/hide password toggle (for Email mode).
  - Mandatory Compliance Checkboxes (on Register mode):
    - `[x]` *"I confirm I am 18 years of age or older."*
    - `[x]` *"I agree to the Terms of Service and Privacy Policy."* (clickable links).
  - Primary Action Button: **"Continue"** / **"Sign In"**.
  - Secondary Links: *"Forgot Password?"*.
- **User Actions:**
  - Toggle between Login and Register.
  - Submit credentials $\rightarrow$ calls `POST /auth/login` or `POST /auth/register`.
  - In phone mode: submits phone $\rightarrow$ calls `POST /auth/otp/request`.
- **Navigation:**
  - $\rightarrow$ `HomeScreen` (on successful login).
  - $\rightarrow$ `OtpVerifyScreen` (if OTP requested or verification required).

---

### 2.3 OTP Verification Screen (`OtpVerifyScreen`)
- **Purpose:** Verifies short-lived numeric codes sent via SMS or Email.
- **Visual Elements:**
  - Instruction label: *"Enter the 6-digit code sent to +91 ******3210"*.
  - 6 separate digit input boxes with auto-focus.
  - Resend countdown timer: *"Resend code in 48s"*.
  - "Resend Code" text button (enabled when timer hits 0).
  - "Verify & Continue" button.
- **User Actions:**
  - Type 6-digit code $\rightarrow$ triggers `POST /auth/otp/verify`.
  - Tap "Resend Code" $\rightarrow$ triggers `POST /auth/otp/request`.
- **Navigation:**
  - $\rightarrow$ `HomeScreen` (on successful verification).
  - $\leftarrow$ Back to `AuthScreen`.

---

### 2.4 Home Screen (`HomeScreen`)
- **Purpose:** Core hub of the application. Allows user to initiate a call, toggle their availability to receive calls, and inspect balance/plan status.
- **Visual Elements:**
  - **Top App Bar:**
    - App title / brand mark.
    - Wallet/Plan Badge (e.g. `Free`, `15 min left`, or `₹50.00` pill) $\rightarrow$ opens `WalletScreen`.
    - Settings Gear icon $\rightarrow$ opens `SettingsScreen`.
  - **Availability Card:**
    - Large toggle switch: **Available to receive calls** (`ON` / `OFF`).
    - Subtitle note: *"When ON, you can receive calls even when the app is closed."*
    - Visual status pill: Green `Available` vs Gray `Offline`.
  - **Central Call Zone:**
    - Prominent, round, glowing **"CALL"** button in center screen.
    - Subtext indicating current billing mode: *"Free Random Calling"* or *"₹1.00 / min"*.
  - **Bottom Navigation / Action Bar:**
    - History icon $\rightarrow$ `CallHistoryScreen`.
    - Safety / Blocked list $\rightarrow$ `BlockedUsersScreen`.
- **User Actions:**
  - Toggle Available Switch $\rightarrow$ calls `PUT /user/availability`.
    - *Note:* If turning ON for the first time, immediately displays `BackgroundHelpModal`.
  - Tap "CALL" $\rightarrow$ navigates to `SearchingScreen`.
  - Tap Wallet Badge $\rightarrow$ navigates to `WalletScreen`.
  - Tap Settings Icon $\rightarrow$ navigates to `SettingsScreen`.
- **Navigation:**
  - $\rightarrow$ `SearchingScreen` (primary call action).
  - $\rightarrow$ `BackgroundHelpModal` (first-time Available toggle).
  - $\rightarrow$ `WalletScreen`, `CallHistoryScreen`, `BlockedUsersScreen`, `SettingsScreen`.

---

### 2.5 Background Guidance Modal (`BackgroundHelpModal`)
- **Purpose:** One-time educational dialog shown when a user switches Available to `ON` for the first time, ensuring calls reach them reliably when the app is closed.
- **Visual Elements:**
  - Shield / Bell illustration.
  - Title: *"Stay Reachable for Calls"*.
  - Bulleted instructions:
    - 1. Enable high-priority notifications.
    - 2. Ensure system battery saver does not sleep this app.
  - Primary Button: **"Open System Settings"** (deep-links to Android App Info).
  - Secondary Button: **"Got It"** (dismisses modal).
- **User Actions:**
  - Opens Android system settings or dismisses guidance.
- **Navigation:**
  - Dismisses back to `HomeScreen`.

---

### 2.6 Searching / Matching Screen (`SearchingScreen`)
- **Purpose:** Full-screen state displayed while the server searches for an available candidate and waits for them to answer.
- **Visual Elements:**
  - Centered pulsing/radar ripple animation.
  - Animated status text:
    - Phase 1: *"Looking for someone available..."*
    - Phase 2: *"Ringing partner..."*
  - Anonymity reassurance: *"Your identity is 100% private."*
  - Bottom Action: Red outline **"Cancel"** button.
- **User Actions:**
  - Tap "Cancel" $\rightarrow$ cancels match attempt and returns to Home.
  - Listens for Socket event `call:matched` or `call:none-available`.
- **Navigation:**
  - $\rightarrow$ `InCallScreen` (when `call:matched` is received).
  - $\leftarrow$ Back to `HomeScreen` (on cancel or if `call:none-available` received).

---

### 2.7 Incoming Call Screen / Full-Screen Alert (`IncomingCallScreen`)
- **Purpose:** Alert shown when another user is calling. Runs as an in-app overlay if app is open, or as a native Android full-screen activity over the lock screen if app was backgrounded/closed.
- **Visual Elements:**
  - Large generic anonymous caller silhouette.
  - Title: **"Incoming Anonymous Call"** *(NO name or number is EVER shown)*.
  - Subtext: *"Internet Audio Call"*.
  - 30-second circular or linear ring countdown indicator.
  - Dual Floating Action Buttons:
    - **Accept** (Large green circular phone icon).
    - **Decline** (Large red circular hang-up icon).
- **User Actions:**
  - Tap "Accept" $\rightarrow$ emits `call:accept { callCode }`.
  - Tap "Decline" $\rightarrow$ emits `call:decline { callCode }`.
  - If 30-second timer expires without input $\rightarrow$ auto-dismisses.
- **Navigation:**
  - $\rightarrow$ `InCallScreen` (on Accept).
  - Dismisses back to previous state (on Decline or Timeout).

---

### 2.8 Active In-Call Screen (`InCallScreen`)
- **Purpose:** Main conversation screen during an ongoing WebRTC audio call.
- **Visual Elements:**
  - **Header:**
    - Anonymous wave/sound avatar.
    - Peer Label: **"Anonymous Partner"**.
    - Live call timer: `MM:SS` (e.g. `04:12`).
    - Network quality indicator (Good / Weak icon).
    - Billing alert ticker (in Per-Minute mode: e.g. *"Balance: 8 mins remaining"*).
  - **Primary Call Controls (Bottom Row):**
    - **Mute Mic:** Toggle button (illuminated when muted).
    - **Speakerphone:** Toggle button (earpiece vs loudspeaker).
    - **End Call:** Large red button with hang-up icon.
  - **Secondary Safety Bar (Upper Row):**
    - **Skip Button:** *"Skip (Next)"* icon button.
    - **Report Flag:** Opens immediate report confirmation.
    - **Block User:** Opens immediate block confirmation.
- **User Actions:**
  - Tap "Mute" $\rightarrow$ mutes local microphone track.
  - Tap "Speaker" $\rightarrow$ routes audio to device speakerphone.
  - Tap "End Call" $\rightarrow$ emits `call:end { reason: "caller_hangup" }`.
  - Tap "Skip" $\rightarrow$ emits `call:end { reason: "skipped" }` and immediately queues a new match.
  - Tap "Report" or "Block" $\rightarrow$ displays in-call safety prompt.
- **Navigation:**
  - $\rightarrow$ `PostCallScreen` (when call terminates).
  - $\rightarrow$ `SearchingScreen` (if Skip was tapped).

---

### 2.9 Post-Call Summary Screen (`PostCallScreen`)
- **Purpose:** Shown immediately after a call ends. Summarizes duration/charges and provides quick safety actions before returning to Home.
- **Visual Elements:**
  - Call Completed Checkmark icon.
  - Title: *"Call Ended"*.
  - Stats Card:
    - Duration: `04:12`.
    - Cost / Deduction: `Free` or `₹5.00 (5 mins)`.
  - **Community Safety Options:**
    - **"Block User"** button: *"Never connect with this person again."*
    - **"Report User"** button: *"Report harassment, abuse, or inappropriate audio."*
  - **Action Buttons:**
    - Primary Button: **"Call Someone Else"** (large button).
    - Secondary Link: *"Back to Home"*.
- **User Actions:**
  - Tap "Block User" $\rightarrow$ calls `POST /user/blocks`.
  - Tap "Report User" $\rightarrow$ opens abuse reason sheet (`POST /user/reports`).
  - Tap "Call Someone Else" $\rightarrow$ navigates to `SearchingScreen`.
  - Tap "Back to Home" $\rightarrow$ navigates to `HomeScreen`.
- **Navigation:**
  - $\rightarrow$ `SearchingScreen` (Call again).
  - $\rightarrow$ `HomeScreen` (Done).

---

### 2.10 Wallet & Plans Screen (`WalletScreen`)
- **Purpose:** Displays wallet balance, active subscription details, and available top-up packages in paid monetization modes.
- **Visual Elements:**
  - Header: Back arrow, *"Wallet & Plans"*.
  - Current Balance Card:
    - Amount: `₹50.00` (or `50 Minutes`).
    - Free trial minutes remaining: `10 mins`.
  - Active Plan Card (if subscribed):
    - Plan Name: *"Unlimited Monthly"*.
    - Status: Active until 21 Dec 2026.
    - Daily limit usage: `25 / 60 mins used today`.
  - Available Plans List:
    - Card per plan (Title, Price, Validity, Daily cap).
  - Recent Transactions List:
    - Small table of past debits/credits (`Call #c7a1 - ₹3.00`, `Welcome Bonus - 10 mins`).
- **User Actions:**
  - Select plan or tap top-up.
- **Navigation:**
  - $\leftarrow$ Back to `HomeScreen`.

---

### 2.11 Call History Screen (`CallHistoryScreen`)
- **Purpose:** Review past call activity with full anonymity preserved.
- **Visual Elements:**
  - Header: Back arrow, *"Call History"*.
  - FlatList of past calls:
    - Title: **"Anonymous Call"** *(NO identity shown)*.
    - Direction badge: `Outgoing` (Caller) or `Incoming` (Callee).
    - Date & Time: `Today, 2:15 PM`.
    - Duration: `3 mins 45 secs`.
    - Action icon: Small "Block" or "Report" icon button next to each entry.
  - Empty state graphic if no calls recorded.
- **User Actions:**
  - Tap "Block" or "Report" on a past call code.
- **Navigation:**
  - $\leftarrow$ Back to `HomeScreen`.

---

### 2.12 Blocked Users Screen (`BlockedUsersScreen`)
- **Purpose:** Review and manage blocked connections.
- **Visual Elements:**
  - Header: Back arrow, *"Blocked Connections"*.
  - Subtitle: *"You will never be matched with these users."*
  - List of blocked entries identified anonymously:
    - Label: *"Blocked User (Call on Nov 20, 2026)"*.
    - Right Action: Red **"Unblock"** button.
  - Empty state: *"You have not blocked anyone."*
- **User Actions:**
  - Tap "Unblock" $\rightarrow$ calls `DELETE /user/blocks/:id`.
- **Navigation:**
  - $\leftarrow$ Back to `HomeScreen`.

---

### 2.13 Settings & Profile Screen (`SettingsScreen`)
- **Purpose:** Account settings, legal agreements, support contact, and account deletion.
- **Visual Elements:**
  - Account Card: Masked email or phone (`u***@example.com`).
  - Preferences Section:
    - Notification preferences toggle.
  - About & Legal Section:
    - *"Terms of Service"* (web link).
    - *"Privacy Policy"* (web link).
    - *"Community Safety Guidelines"* (web link).
    - *"Support & Grievance Contact"* (opens email intent).
  - Account Actions:
    - **"Log Out"** button.
    - **"Delete Account"** button (red text, opens confirmation dialog with data erasure disclaimer).
- **User Actions:**
  - Tap "Log Out" $\rightarrow$ calls `POST /auth/logout`.
  - Tap "Delete Account" $\rightarrow$ calls `DELETE /me`.
- **Navigation:**
  - $\rightarrow$ `AuthScreen` (upon logout or deletion).
  - $\leftarrow$ Back to `HomeScreen`.

---

## 3. Web Admin Panel Screens (React + Vite)

### Overview of Admin Navigation Hierarchy

```
[ Admin App ]
  ├── AdminLoginView (Email, Password, TOTP MFA)
  └── AdminLayout (Sidebar + Content Header)
        ├── AdminDashboardView (Real-time vitals, counters, call stats)
        ├── AdminSettingsView (Monetization, auth toggles, rates, thresholds)
        ├── AdminUsersView (Search, inspect, suspend, ban, wallet grant)
        ├── AdminReportsView (Moderation queue, resolve reports, apply bans)
        └── AdminPlansView (Create & manage subscription plans)
```

---

### 3.1 Admin Login Screen (`AdminLoginView`)
- **Purpose:** Secure authentication for administrators and moderators.
- **Visual Elements:**
  - Clean branded card on dark backdrop.
  - Email and Password inputs.
  - 6-digit TOTP Two-Factor Authentication field.
  - "Log In to Admin Console" button.
- **User Actions:**
  - Submits to `POST /admin/auth/login`.
- **Navigation:**
  - $\rightarrow$ `AdminDashboardView`.

---

### 3.2 Dashboard Screen (`AdminDashboardView`)
- **Purpose:** Immediate view of platform health, real-time load, and key performance indicators.
- **Visual Elements:**
  - **Live Vitals Bar:**
    - Active WebSockets Online (e.g. `48`).
    - Available Users Right Now (e.g. `26`).
    - Active Concurrent Calls (e.g. `4`).
  - **Daily Metric Cards:**
    - Total Users Registered (e.g. `1,250`).
    - Calls Placed Today (e.g. `215`).
    - Talk Minutes Today (e.g. `546 mins`).
    - Revenue Today (e.g. `₹480.00`).
  - **Safety Alert Banner:**
    - Red alert box if pending abuse reports $> 0$ (e.g. *"3 pending abuse reports require review"*).
  - **24-Hour Call Volume Chart:**
    - Simple hourly bar/line chart of calls placed.
- **User Actions:**
  - Click safety alert banner $\rightarrow$ opens `AdminReportsView`.
- **Navigation:**
  - Sidebar links to all admin modules.

---

### 3.3 Global App Settings Screen (`AdminSettingsView`)
- **Purpose:** Dynamically adjust system rules, billing modes, and safety thresholds without redeploying code.
- **Visual Elements:**
  - **Monetization Section:**
    - Radio Selector: `[ Free MVP ]` | `[ Subscription ]` | `[ Per-Minute ]`.
    - Per-minute rate input (e.g. `1.00`).
    - Currency selector (`INR`, `USD`).
    - Free trial minutes for new accounts (e.g. `10`).
    - Daily free minute cap (e.g. `30`).
  - **Authentication Section:**
    - Toggle: `Allow Email & Password Login` (Default: ON).
    - Toggle: `Allow Mobile Phone OTP Login` (Default: OFF per Rules).
    - OTP expiration seconds (e.g. `300`).
  - **Matching & Calling Section:**
    - Ring timeout seconds (default `30`).
    - Max match retries (default `3`).
    - Cooldown between same pair in minutes (default `30`).
  - **Moderation Thresholds Section:**
    - Auto-suspension report trigger: `3` reports within `24` hours.
    - Auto-suspension duration: `48` hours.
  - **Save Settings Button:**
    - Emits `PUT /admin/settings/:key`.
- **User Actions:**
  - Modify parameters and save. Changes take effect on backend immediately.

---

### 3.4 User Management Screen (`AdminUsersView`)
- **Purpose:** Search and inspect registered user accounts, view report history, and apply administrative suspensions or bans.
- **Visual Elements:**
  - **Filter Bar:** Search input (email/phone/UUID), Status dropdown (`All`, `Active`, `Suspended`, `Banned`).
  - **User Data Table:**
    - Columns: User ID, Identifier, Status Badge, Available Switch (`ON`/`OFF`), Wallet Balance, Report Count, Joined Date, Actions.
  - **User Detail Drawer (Slide-out):**
    - Account details and recent call log.
    - Wallet ledger balance with **"Adjust Balance"** button (Credit/Debit with mandatory reason note).
    - Safety Actions:
      - **"Suspend User (48 Hours)"**.
      - **"Permanent Ban"**.
      - **"Reactivate / Unban"**.
- **User Actions:**
  - Search users $\rightarrow$ `GET /admin/users`.
  - Update status $\rightarrow$ `PATCH /admin/users/:id/status`.
  - Manual wallet adjustment $\rightarrow$ `POST /admin/users/:id/wallet`.

---

### 3.5 Abuse Reports & Moderation Screen (`AdminReportsView`)
- **Purpose:** Review abuse reports submitted by users and take corrective moderation actions.
- **Visual Elements:**
  - **Status Filter Tabs:** `Pending (3)` | `Resolved` | `Dismissed`.
  - **Reports Data Table:**
    - Columns: Report ID, Date/Time, Call Code, Reason (`Harassment`, `Sexual Content`, `Scam`, `Spam`, `Other`), Reporter ID, Reported User ID, Reporter Note, Action.
  - **Report Resolution Modal:**
    - Shows call session metadata (duration, start/end time).
    - Shows reported user's historical report count and previous warnings.
    - Admin action buttons:
      - **"Dismiss Report"** (no action taken).
      - **"Issue Warning"**.
      - **"Suspend Reported User (48h)"**.
      - **"Ban Reported User Permanently"**.
    - Internal admin resolution notes field.
- **User Actions:**
  - Inspect report and apply resolution $\rightarrow$ `PATCH /admin/reports/:id`.

---

### 3.6 Subscription Plans Management Screen (`AdminPlansView`)
- **Purpose:** Configure subscription packages offered when Subscription mode is activated.
- **Visual Elements:**
  - Top Action: **"+ Create New Plan"** button.
  - **Plans Table:**
    - Columns: Plan Name, Price, Currency, Duration (Days), Daily Minute Cap, Active Status Toggle, Edit/Delete.
  - **Plan Editor Modal:**
    - Inputs: Plan Name, Description, Price, Duration in Days, Daily Minute Cap (optional, leave blank for unlimited).
- **User Actions:**
  - Create, toggle active state, or edit plan tiers.
