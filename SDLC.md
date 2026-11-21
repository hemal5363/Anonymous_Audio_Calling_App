**SOFTWARE DEVELOPMENT LIFE CYCLE DOCUMENT**

# Anonymous Audio Calling App

### Random one-to-one internet voice calling with admin-controlled billing and login

| **Item** | **Detail** |
| --- | --- |
| Product | Anonymous random one-to-one audio calling mobile app (MVP) |
| Mobile platform | Android first, built with React Native (iOS later from the same code) |
| Backend and admin | Node.js (NestJS), PostgreSQL, React admin panel |
| Hosting | Single AWS Free Tier EC2 instance (Mumbai region), running cost target: zero |
| Document version | 1.1 (MVP baseline, updated for the Available switch) |
| Change in 1.1 | Availability is now controlled by the user's Available on/off switch and works with the app open, in the background or closed (push wake-up). |
| Date | 21 November 2026 |
| Status | Approved plan, ready for development kickoff |

## Contents

1. Planning (Charter, Scope, Feasibility, Cost Plan, Risks, Timeline)
2. Requirements (BRD, SRS, Non-functional, User Stories, Use Cases)
3. Design (Architecture, Flows, Database, API, Wireframes, Security and Privacy)
4. Development (Standards, Repositories, Git Strategy, Sprint Plan)
5. Testing (Test Plan, Test Cases, Load and Security Testing)
6. Deployment (AWS Free Tier Guide, CI/CD, Play Store Checklist)
7. Maintenance (Monitoring, Backups, Incident Response, Roadmap)
8. Appendices (Privacy Policy and Terms Outlines, Compliance Notes, Glossary)

> **How to read this document.** Sections 1 to 8 follow the SDLC phases in order. Items marked **Assumption** are decisions made to keep the MVP small and free to run. They are listed again in Section 1.9 so you can confirm or change them before development starts. Third-party prices, free-tier limits and store policies change often, so verify each one on the provider's website before you rely on it.

# 1. Planning Phase

## 1.1 Project Charter

| **Field** | **Detail** |
| --- | --- |
| Project name | Anonymous Audio Calling App (working title) |
| Purpose | Let a registered user press one Call button and speak, over the internet, with a random available user, without either side seeing a name, number or any profile detail. |
| Business goal | Launch a working, private, low-cost MVP on Android that can later earn revenue through admin-controlled plans or per-minute charges. |
| Success criteria | 1) Two users connect and talk with clear audio. 2) Neither user can see the other's identity. 3) Admin can switch between Free, Subscription and Per-minute modes without a new app release. 4) The whole system runs on one free-tier AWS EC2 instance. |
| Sponsor and owner | Product owner (you). Final decisions on scope, budget and launch. |
| Constraints | Zero or minimum running cost. Single small server. Android first. Audio only. |

## 1.2 Objectives

- Deliver an Android MVP with account creation, random anonymous audio calling and safety controls.
- Deliver a web admin panel for monetization mode, login methods, users, reports and basic analytics.
- Keep users private from each other and keep call audio unrecorded.
- Deploy backend and admin panel on one AWS free-tier EC2 instance.
- Prepare the design so payments and iOS can be added later without rewriting the core.

## 1.3 Scope

### In scope for the MVP

- Account creation and login by email and password. Mobile OTP login is built but switched off by default and enabled by the admin.
- Home screen with an Available on/off switch and a Call button. A user who switches Available on can receive anonymous calls even when the app is in the background or closed, through a push wake-up and a full-screen incoming call alert with Accept and Decline.
- Encrypted peer audio calls using WebRTC through a TURN relay so IP addresses stay hidden.
- In-call Mute, Speaker, End, Skip (end and call someone new), Report and Block.
- Admin-configurable billing: Free, Subscription, Per-minute. Prepaid wallet and plan logic built and tested. Admin can grant credits or plans manually.
- Admin web panel: settings, users, reports, bans, dashboard, audit log.
- 18+ confirmation, terms and privacy acceptance, account deletion inside the app.

### Out of scope for the MVP (phase 2 and later)

- Online payment collection (Google Play Billing or Razorpay). The module is designed but not connected.
- Video calls, text chat, friend lists, call history with other users, gender or language filters.
- iOS release, call recording, AI voice moderation, scheduled quiet hours for the Available switch.

## 1.4 Stakeholders and Roles

| **Role** | **Responsibility** |
| --- | --- |
| Product owner | Approves scope, budget, policies (terms, privacy), and store listing. |
| Developer(s) | Build React Native app, NestJS backend, admin panel, deployment. |
| Admin or moderator | Uses admin panel to set billing mode, review reports, ban abusive users. |
| End user | Registers, calls and receives anonymous calls. |
| Grievance officer | Named contact for user complaints, required for Indian compliance (see Appendix). |

## 1.5 Feasibility Study

| **Area** | **Finding** |
| --- | --- |
| Technical | Feasible. A 1:1 audio call is a standard WebRTC use case. No media server is needed because audio flows phone to phone (or through TURN). Mature libraries exist for React Native. Calls to closed apps need a push wake-up and a full-screen alert, which is standard for calling apps but depends on each phone's battery settings. |
| Operational | Feasible for one developer to run. One server, one database, Docker Compose or PM2. Admin panel covers day-to-day moderation. |
| Economic | Feasible at zero running cost within AWS free-tier limits. Unavoidable store costs are listed in Section 1.6. |
| Legal and policy | Feasible with safeguards. Anonymous random calling attracts abuse, so Google Play and Indian rules expect reporting, blocking, age gating and a grievance process. These are included in the MVP. |
| Schedule | About 13 weeks for a small team (see Section 1.8). |
| Main limitation | One 1 GB server limits scale to an MVP load of a few hundred concurrent users. A scale-up path is given in Section 7. |

## 1.6 Cost Plan

| **Item** | **MVP cost** | **Notes** |
| --- | --- | --- |
| EC2 instance (t2.micro or t3.micro) | Free in free tier | 750 hours a month. Terms depend on when your AWS account was created. Check the Billing console for your free-tier end date. |
| Storage (EBS) | Free up to 30 GB | Enough for MVP database and logs. |
| Data transfer out | Free up to 100 GB a month | Relay-only audio uses about 0.6 to 0.75 MB per call minute, so roughly 130,000 call minutes a month. |
| Public IPv4 address | Free in first 12 months | AWS charges for public IPv4 after the free period. Plan for a small monthly cost later. |
| Domain and HTTPS | Free | DuckDNS subdomain and Let's Encrypt certificate. Buy a domain later for a professional look. |
| Email (verification) | Free tier | Brevo or similar free SMTP plan. Verify the current daily limit. |
| Push notifications | Free | Firebase Cloud Messaging. |
| Monitoring and builds | Free tier | Sentry free plan, GitHub Actions free minutes. |
| Mobile OTP (SMS) | Not free | Off by default. Provider and price chosen when the admin enables it. |
| Google Play developer account | One-time USD 25 | Only if you publish on Google Play. Not needed for testing with a shared APK. |
| Google Play service fee | Percentage of in-app sales | Applies only after paid plans or credits are sold inside the app. |

> **Billing safety.** Create an AWS Budget alert at USD 1 and a CloudWatch billing alarm before launch. This protects you from surprise charges if traffic grows beyond the free tier.

## 1.7 Risk Register

| **ID** | **Risk** | **Impact** | **Mitigation** |
| --- | --- | --- | --- |
| R1 | Users abuse anonymous calls (harassment, scams, adult content) | High | 18+ gate, Report, Block, Skip, repeat-offender bans, device bans, admin review, grievance contact. |
| R2 | Google Play rejects or removes the app | High | Follow User Generated Content and Account Deletion policies, use Play Billing for digital goods, clear privacy policy. |
| R3 | Free server overloaded (RAM or CPU credits) | Medium | Swap file, tuned PostgreSQL, load test early, documented scale-up to a larger instance. |
| R4 | Calls fail on some mobile networks (NAT) | Medium | Run coturn TURN with TCP and TLS fallback on port 443 or 5349. |
| R5 | Free-tier period ends or limits exceeded | Medium | Billing alarm, usage review each month, documented cost after free tier. |
| R6 | OTP SMS bill abuse by bots | Medium | Mobile login off by default, rate limits, captcha, daily SMS cap set by admin. |
| R7 | Billing cheating (client side timers) | Medium | Server-side call timer and wallet ledger. Phones never decide charges. |
| R8 | Privacy leak (IP or identity exposed) | High | Relay-only calls, random per-call IDs, no user IDs sent to peers, no audio storage. |
| R9 | Data protection non-compliance (DPDP Act) | Medium | Minimal data, consent, deletion, retention limits, legal review before public launch. |
| R10 | Single point of failure (one server) | Medium | Daily backups to S3 free tier or off-server copy, tested restore, simple rebuild script. |
| R11 | Push wake-up fails or is delayed on some phones (battery saver, brand-specific background limits, uninstalled app) | Medium | High-priority push, longer ring time (30 seconds), live-connected users tried first, unreachable users skipped, one-time help screen, test on several phone brands. |
| R12 | Users receive unwanted calls from strangers | Medium | Available is OFF by default, clear consent text, Decline, Block and Report, one-tap Available OFF that takes effect immediately. |

## 1.8 Timeline (MVP, about 13 weeks)

**Assumption:** one to two developers working full time. Adjust the weeks if the team is different.

| **Sprint** | **Weeks** | **Focus** | **Deliverable** |
| --- | --- | --- | --- |
| 0 | 1 | Setup | Repositories, AWS server, CI skeleton, designs approved. |
| 1 | 2-3 | Accounts and admin base | Registration, login (email), JWT, admin login, settings table, public config API. |
| 2 | 4-6 | Availability, push and matching | Available switch, device tokens, push wake-up, full-screen incoming alert, WebSocket server, random matching with push fallback. |
| 3 | 7-8 | Calling | WebRTC audio via coturn, in-call controls, call end and Skip. |
| 4 | 9-10 | Billing and safety | Plans, wallet ledger, server timer, Report, Block, bans, 18+ gate. |
| 5 | 11-12 | Admin and hardening | Admin dashboard, reports review, mobile OTP module, rate limits, account deletion. |
| 6 | 13 | Release | Load test, security test, push tests on several phone brands, closed testing, Play Store submission. |

## 1.9 Assumptions to Confirm

| **#** | **Assumption** | **Why** |
| --- | --- | --- |
| A1 | A user is Available when they have switched the Available switch on in the app, whether the app is open, in the background or closed. New accounts start with Available OFF. | The user's own switch is the consent to receive calls. Reaching closed apps needs push notifications and a full-screen call alert (about one extra week of work). |
| A2 | The caller presses Call. The server picks a random user whose Available switch is on and shows them an anonymous Accept or Decline alert (full screen if the app is closed or the phone is locked). | Gives the receiver control and avoids forced connections. |
| A3 | In paid modes only the caller pays. The receiver is never charged. | Simplest fair rule. Can be made configurable later. |
| A4 | Email login is on by default. Mobile OTP login is off by default. | Keeps cost at zero until the admin chooses a provider. |
| A5 | No call audio is recorded or stored. | Privacy promise. Reports rely on metadata and repeat reports. |
| A6 | MVP target load is about 200 concurrent users and 50 simultaneous calls on the free server. | Estimate only. Confirm with load test in Sprint 6. |
| A7 | Payments are not collected online in the MVP. Admin can grant credits or plans manually. | Avoids payment fees and store billing work at launch. |
| A8 | Closed-app wake-up uses Firebase Cloud Messaging (free). Delivery depends on the phone's battery settings, so the ring time defaults to 30 seconds and live-connected users are tried first. | Some phone brands delay or block background activity. This cannot be fully controlled by the app. |

# 2. Requirements Phase

## 2.1 Business Requirements (BRD)

| **ID** | **Business requirement** | **Priority** |
| --- | --- | --- |
| BR1 | Users can talk to a random stranger privately, with no name, number or profile shown. | Must |
| BR2 | Users must create an account, so abuse can be traced and banned by the platform. | Must |
| BR3 | The owner can choose how the app earns: free, subscription plans, or per-minute charging, from an admin panel without a new app release. | Must |
| BR4 | The owner can enable or disable email login and mobile login from the admin panel. | Must |
| BR5 | The service must run at near-zero cost on AWS free tier for the MVP. | Must |
| BR6 | The app must include safety tools so it can pass store review and meet legal expectations. | Must |
| BR7 | The platform must be able to grow later (payments, iOS, more features) without a rewrite. | Should |

## 2.2 Functional Requirements (SRS)

### A. Account and login

| **ID** | **Requirement** |
| --- | --- |
| FR-A1 | User can register with email and password. Email must be verified with a link or code before calling. |
| FR-A2 | If the admin enables mobile login, user can register or log in with a mobile number and an OTP. |
| FR-A3 | User must confirm they are 18 or older and accept the Terms and Privacy Policy at sign-up. Acceptance time and version are stored. |
| FR-A4 | Login returns a short-lived access token and a rotating refresh token. User can log out of the device. |
| FR-A5 | User can reset a forgotten password by email. |
| FR-A6 | User can delete their account inside the app. Personal data is erased or anonymized per the retention rules. |
| FR-A7 | The app reads a public config endpoint at start-up and shows only the login methods the admin has enabled. |

### B. Presence and matching

| **ID** | **Requirement** |
| --- | --- |
| FR-B1 | User has an Available switch on the home screen and in settings. It is OFF for new accounts. The setting is saved on the server and stays as the user set it, whether the app is open, in the background or closed. Turning it ON asks for notification permission and registers the phone for push. |
| FR-B2 | Pressing Call sends a call request. The server chooses a random user whose Available switch is on, who is reachable (live connection or valid push token), not in a call, not blocked either way, not banned, and not recently matched with the caller. Users with a live connection are tried first. |
| FR-B3 | The chosen user sees an anonymous incoming call screen (no identity) with Accept and Decline. If the app is in the background, locked or closed, the server sends a high-priority push and the phone shows a full-screen alert with ringtone. Ring time is configurable (default 30 seconds). |
| FR-B4 | If declined or timed out, the server tries another eligible user, up to a configurable number of attempts (default 3), then tells the caller nobody is available. |
| FR-B5 | Neither user ever receives the other's user ID, name, email, number or IP address. Each call uses a random call ID. |
| FR-B6 | Turning Available OFF takes effect immediately: the user is never selected, no push is sent to them for calls, and no alerts are shown. |
| FR-B7 | Push messages contain only a message type and a random call code, never caller identity. |
| FR-B8 | If a phone does not respond to push (no token, invalid token, repeated no response), the server marks the user temporarily unreachable and skips them until their app next connects. |
| FR-B9 | When Available is turned on, a one-time help screen explains notification and battery settings and links to the phone's settings. The app does not ask for a battery-optimization exemption permission. |

### C. Calling

| **ID** | **Requirement** |
| --- | --- |
| FR-C1 | After Accept, both phones exchange WebRTC offer, answer and ICE candidates through the server. |
| FR-C2 | Audio is encrypted and relayed through the project's TURN server (relay-only policy). |
| FR-C3 | In-call controls: Mute, Speaker or earpiece, End, Skip, Report, Block. |
| FR-C4 | Skip ends the current call and starts a new Call request. |
| FR-C5 | The app shows a call timer and a poor-network indicator. If the connection drops for more than a set time (default 15 seconds) the call ends. |
| FR-C6 | A maximum call duration can be set by the admin (default: unlimited). |

### D. Billing (admin controlled)

| **ID** | **Requirement** |
| --- | --- |
| FR-D1 | Admin chooses one active mode: FREE, SUBSCRIPTION or PER_MINUTE. The change applies to new calls immediately. |
| FR-D2 | FREE: no checks and no charges. Optional free daily minutes limit can be set. |
| FR-D3 | SUBSCRIPTION: caller needs an active plan (admin defines plans with name, price, duration and optional daily minute cap). Without a plan the Call button shows the plan screen. |
| FR-D4 | PER_MINUTE: caller needs at least a minimum wallet balance. The server deducts the admin-set rate for each started minute and ends the call when funds run out. |
| FR-D5 | Admin can set free trial minutes for new users in paid modes. |
| FR-D6 | Wallet changes are stored as immutable ledger entries. Admin can credit or debit a wallet or grant a plan manually, with a reason that goes to the audit log. |
| FR-D7 | In the MVP no online payment is collected. The payment module has a provider interface so Play Billing or Razorpay can be plugged in later. |

### E. Safety and moderation

| **ID** | **Requirement** |
| --- | --- |
| FR-E1 | User can Report the last call with a reason (abuse, sexual content, scam, spam, underage, other) and optional note. |
| FR-E2 | User can Block the last caller. Blocked pairs never match again. The blocked party is not told. |
| FR-E3 | Admin can review reports, warn, suspend or ban a user, and ban a device. |
| FR-E4 | Automatic temporary suspension when a user receives reports above an admin-set threshold in a time window. |
| FR-E5 | Rate limits on login, OTP, call requests and reports. |

### F. Admin panel

| **ID** | **Requirement** |
| --- | --- |
| FR-F1 | Admin login with strong password and optional two-factor code (TOTP). |
| FR-F2 | Settings page: billing mode, rates, plans, login methods, OTP provider keys, ring time, retry count, call limits, report threshold. |
| FR-F3 | Users page: search, view status, wallet, plan, report count, suspend or ban. |
| FR-F4 | Reports page: queue, details (call time, duration, reasons), action buttons. |
| FR-F5 | Dashboard: registered users, online users, active calls, call count and minutes per day, revenue or credits issued. |
| FR-F6 | Audit log of every admin action. |

## 2.3 Non-Functional Requirements

| **Area** | **Requirement** |
| --- | --- |
| Performance | Call setup (press Call to ringing) under 3 seconds for most requests, and connected audio within 5 seconds after Accept. Target one-way audio delay under 300 ms on normal 4G. |
| Closed-app calls | Alert shown within about 5 seconds of the push on most phones. Actual delivery depends on the phone model, battery settings and network, and is tested on several brands. |
| Capacity (MVP) | About 200 concurrent connected users and 50 simultaneous calls on one free-tier server (Assumption A6, to be verified). |
| Availability | Best effort, target 99 percent monthly. Single server with automatic restart (PM2 or Docker restart policy). |
| Security | TLS everywhere, encrypted audio, hashed passwords, rate limiting, admin 2FA, least-privilege firewall. |
| Privacy | No identity shown between users, no audio stored, minimal metadata, deletion on request, retention limits. |
| Usability | One main action on the home screen. In-call controls reachable with one thumb. Works on Android 8 and above (to be confirmed against the Play target requirements). |
| Compatibility | Mobile data and Wi-Fi, TURN fallback over TCP and TLS. Battery saver and brand-specific background limits can delay push, so a help screen is provided. |
| Maintainability | TypeScript, linting, tests, one repository per component, documented environment variables. |
| Cost | Zero running cost inside the AWS free tier. Alerts when usage nears limits. |

## 2.4 User Stories

| **ID** | **As a...** | **I want to...** | **So that...** |
| --- | --- | --- | --- |
| US1 | new user | sign up with my email and password | I can start using the app. |
| US2 | new user | confirm I am 18+ and accept the terms | I understand the rules and can use the app legally. |
| US3 | user | press one Call button | I can quickly talk to someone. |
| US4 | user | see no name or number of the other person | my privacy and theirs is protected. |
| US5 | user | accept or decline an incoming anonymous call | I stay in control of who I talk to. |
| US6 | user | mute, use speaker, end or skip | I can manage the call. |
| US7 | user | report or block someone | I feel safe using the app. |
| US8 | user | see my plan or balance when paid mode is on | I know what I can spend. |
| US9 | user | delete my account | my data is removed when I leave. |
| US10 | admin | switch between Free, Subscription and Per-minute | I can decide how the app earns. |
| US11 | admin | turn mobile login on or off | I control SMS cost and sign-up methods. |
| US12 | admin | review reports and ban abusers | the community stays safe. |
| US13 | admin | see call and user statistics | I can track growth and cost. |
| US14 | user | turn Available on or off | I decide when strangers can call me, even when my app is closed. |
| US15 | user | get a full-screen alert for an incoming call even if my phone is locked | I do not miss calls I chose to receive. |

## 2.5 Use Cases

### UC-01 Make an anonymous call

| **Item** | **Detail** |
| --- | --- |
| Actor | Caller (registered user). Secondary actor: Receiver. |
| Preconditions | Caller is logged in and verified. Billing check passes for the active mode. At least one other user has Available switched on. |
| Main flow | 1) Caller presses Call. 2) Server checks billing and rate limits. 3) Server picks a random eligible user whose Available switch is on (live-connected users first). 4) The receiver's phone shows an anonymous incoming call alert (inside the app, or full screen through push if the app is in the background or closed) and the receiver accepts. 5) Phones exchange WebRTC signals through the server. 6) Audio connects through TURN. 7) Server starts the call timer. 8) Either side ends the call. 9) Server closes the call, finalizes billing and shows the Report or Block option. |
| Alternate flows | A) Receiver declines or times out: server tries next user. B) No user available: caller sees a friendly message. C) Balance runs out in Per-minute mode: server warns at 1 minute left, then ends the call. D) Network drops: call ends after the reconnect window. E) Receiver's phone does not wake or respond to push: treated as no answer, user may be marked unreachable. |
| Postconditions | Call record stored with random call ID, times, duration, end reason. Wallet ledger updated if charged. |

### UC-02 Report and block

| **Item** | **Detail** |
| --- | --- |
| Actor | User after or during a call. |
| Main flow | 1) User taps Report or Block. 2) User selects a reason. 3) App sends the call ID. 4) Server maps the call ID to the other user internally. 5) Server saves the report or block. 6) Admin sees the report in the queue. |
| Rules | The reporter never sees the other user's identity. Blocked pairs never match again. |

### UC-03 Admin changes billing mode

| **Item** | **Detail** |
| --- | --- |
| Actor | Admin. |
| Main flow | 1) Admin logs in with 2FA. 2) Opens Settings, then Billing. 3) Selects mode and sets rates or plans. 4) Saves. 5) Server stores the setting, writes an audit log entry and applies it to new calls. 6) Apps read the new public config on next start or refresh. |

### UC-04 Admin enables mobile login

| **Item** | **Detail** |
| --- | --- |
| Actor | Admin. |
| Main flow | 1) Admin opens Settings, then Login Methods. 2) Enters OTP provider details and a daily SMS cap. 3) Turns Mobile Login on. 4) Server saves and logs the change. 5) New app sessions show the mobile login option. |

### UC-05 Receive a call with the app closed

| **Item** | **Detail** |
| --- | --- |
| Actor | Receiver (registered user with Available switched on). |
| Preconditions | Available is ON, notification permission granted, phone registered for push, user not in a call. |
| Main flow | 1) Server selects the receiver for a call request. 2) No live connection exists, so the server sends a high-priority push with the call code. 3) The phone wakes the app in the background and shows a full-screen incoming alert with ringtone. 4) Receiver taps Accept. 5) App opens, connects to the server and sends call:accept. 6) Server sends TURN credentials and the normal call flow continues. |
| Alternate flows | A) Receiver taps Decline or ignores it: server tries another user after the ring time. B) Push never arrives: no answer, same as A. C) Receiver switched Available OFF just before: not selected. |

### UC-06 Change availability

| **Item** | **Detail** |
| --- | --- |
| Actor | User. |
| Main flow | 1) User moves the Available switch on the home screen. 2) App sends the new value to the server. 3) Server saves it and, for ON, confirms the phone's push token is registered. 4) From that moment the user can or cannot be selected. 5) The app shows a one-time help screen on first use of ON. |

# 3. Design Phase

## 3.1 System Architecture

The whole system runs on one EC2 instance. Audio does not pass through the application server. It flows between the two phones, relayed by the TURN server so that each phone only ever sees the server's address.

```
  +-------------------+                          +-------------------+
  |  Android app (A)  |                          |  Android app (B)  |
  |   React Native    |                          |   React Native    |
  +---------+---------+                          +---------+---------+
            |  HTTPS (REST) + WSS (signaling)              |
            |                                              |
  ==========|==============  AWS EC2 (free tier)  ==========|===========
            v                                              v
     +-------------------------------------------------------------+
     |  Nginx (443)  -> TLS, static admin panel, reverse proxy     |
     +--------+----------------------------------+-----------------+
              |                                  |
     +--------v---------+              +---------v----------+
     |  NestJS backend  |              |  coturn (TURN)     |
     |  REST + Socket.IO|              |  3478 / 5349 / 443 |
     |  matching queue  |              |  audio relay only  |
     +--------+---------+              +--------------------+
              |
     +--------v---------+      +----------------------+
     |   PostgreSQL     |      |  Daily backup (S3 or |
     |   (same server)  |----->|  off-server copy)    |
     +------------------+      +----------------------+
 
  Audio path:  Phone A  <== encrypted (DTLS-SRTP) ==>  coturn  <==>  Phone B
 
  External free services: Firebase (FCM), SMTP email, Sentry, Let's Encrypt
```

## 3.2 Component Responsibilities

| **Component** | **Technology** | **Responsibility** |
| --- | --- | --- |
| Mobile app | React Native, TypeScript, react-native-webrtc, react-native-incall-manager, @react-native-firebase/messaging, Notifee | UI, login, Available toggle, Call button, WebRTC audio, in-call controls, wallet and plan screens. |
| Backend API | NestJS (Node.js), TypeORM or Prisma, Socket.IO | Auth, config, wallet and plans, reports and blocks, signaling, matching, call timer. |
| Matching and presence | In-memory map of live connections plus the Available flag in PostgreSQL | Live-connected users are tracked in memory. The Available switch and push token are stored in the database. Single instance, so no Redis needed in the MVP. |
| Push service | Firebase Cloud Messaging (free), called from the backend with the Firebase Admin SDK | Wakes background or closed phones for incoming calls. Payload holds only a type and a call code. |
| TURN server | coturn with REST ephemeral credentials | Relays encrypted audio. Hides each user's IP from the other. |
| Database | PostgreSQL 15 or 16 | Persistent data (see Section 3.6). |
| Admin panel | React (Vite) static build served by Nginx | Settings, users, reports, dashboard. |
| Reverse proxy | Nginx + Let's Encrypt | HTTPS, WSS proxy, static files, rate limiting. |
| CI/CD | GitHub Actions | Test, build, deploy over SSH. |

## 3.3 Call Flow

```
Caller A                 Backend                  Receiver B                 coturn
  |                         |                         |                         |
  |----- call:request ----->|                         |                         |
  |                         | billing check, pick random B                      |
  |                         |- call:incoming (anon) ->|                         |
  |                         |<----- call:accept ------|                         |
  |<-- call:matched+TURN ---|                         |                         |
  |                         |--- call:matched+TURN -->|                         |
  |------------ signal:offer (via server) ----------->|                         |
  |<---------- signal:answer (via server) ------------|                         |
  |======================== ICE: relay candidates only ========================>|
  |========================= encrypted audio via TURN =========================>|
  |                         |                         |<=== audio forwarded ====|
  |---- call:connected ---->|                         |                         |
  |                         |<--- call:connected -----|                         |
  |                         | server timer starts, billing ticks                |
  |--- call:end (either) -->|                         |                         |
  |<-- call:ended+prompt ---|                         |                         |
  |                         |--- call:ended+prompt -->|                         |
```

If B declines or does not answer within the ring time, the backend picks another eligible user and repeats, up to the retry limit. If nobody accepts, A receives a no-one-available message and no charge is made.

### Incoming call when the receiver's app is closed or in the background

```
  Backend                 FCM                       Receiver B phone
     |                     |                             |
     |----- send push ---->|                             |
     |                     |---- high-priority push ---->|
     |                     |                             | app wakes in background
     |                     |                             | full-screen alert + ringtone
     |                     |                             | B taps Accept, app opens
     |<======= WebSocket connects + call:accept =========|
     |--------------- call:matched + TURN -------------->|
     | normal call flow continues                        |
```

Users who already have a live connection are tried first because they answer fastest. Users reachable only by push are tried next. Push is only used for users whose Available switch is on.

## 3.4 Matching Logic

- Eligible receiver = Available switch ON, reachable (live WebSocket connection or a valid push token), not in a call, not banned or suspended, not blocked by or blocking the caller, not matched with the caller in the last N minutes (admin setting).
- Selection is random from the eligible set, so users cannot choose or target someone.
- A per-user lock prevents two callers ringing the same receiver at the same time.
- Each call gets a random call ID. Only the backend can map a call ID to users. Clients never receive user IDs.
- Availability is the user's own switch, saved in the database. Closing the app does not change it (Assumption A1). New accounts start with Available OFF.
- A user who repeatedly fails to respond to push, or whose push token is invalid, is marked temporarily unreachable (default 60 minutes) until their app next connects.
- Ring time defaults to 30 seconds so phones woken by push have time to show the alert. The caller sees a Searching screen while the server tries up to the maximum attempts one after another.

## 3.5 Billing and Wallet Design

The backend owns all billing decisions. The phone only displays what the server sends.

| **Mode** | **Check before call** | **During call** | **After call** |
| --- | --- | --- | --- |
| FREE | Optional free-minutes limit per day. | No charges. | Store duration. |
| SUBSCRIPTION | Active plan exists and daily minute cap not reached. | Server tracks minutes against the cap and ends the call if reached. | Store duration, update plan usage. |
| PER_MINUTE | Wallet balance is at least the minimum balance setting. | At call start and every 60 seconds the server deducts the per-minute rate. A warning is sent when about one minute of balance remains. The call ends when funds are insufficient. | Final ledger entries, balance sent to the app. |

- Charging is per started minute. The rate, minimum balance and free trial minutes are admin settings.
- Wallet balance is the sum of immutable ledger rows (type: credit, debit, adjustment, refund). Balance is never edited directly.
- Admin manual credits and plan grants require a reason and are written to the audit log.
- A payment provider interface (verify purchase, add credit or plan) is defined now and implemented in phase 2.

## 3.6 Database Design

PostgreSQL. All tables use UUID primary keys and created_at timestamps. Key tables and columns:

| **Table** | **Key columns** | **Purpose** |
| --- | --- | --- |
| users | id, status (active, suspended, banned, deleted), is_available (default false), available_changed_at, age_confirmed_at, terms_version, privacy_version, created_at, deleted_at | One row per account. |
| auth_identities | id, user_id, type (email or mobile), value_hash, value_encrypted, verified_at, password_hash | Login methods. Email and mobile are stored encrypted, searched by hash. |
| refresh_tokens | id, user_id, token_hash, device_id, expires_at, revoked_at | Rotating refresh tokens. |
| devices | id, user_id, device_fingerprint_hash, fcm_token, push_status, unreachable_until, banned, last_seen_at | Device-level bans and limits, and the push token used to wake the phone. |
| otp_requests | id, target_hash, code_hash, expires_at, attempts, created_at | OTP records for rate limiting and verification. |
| settings | key, value_json, updated_by, updated_at | Admin configuration (billing mode, rates, login switches, limits). |
| plans | id, name, price, duration_days, daily_minute_cap, active | Subscription plans created by admin. |
| subscriptions | id, user_id, plan_id, starts_at, ends_at, source (admin, purchase) | A user's plan history. |
| wallet_entries | id, user_id, type, amount, minutes, call_id, reason, created_by, created_at | Immutable ledger. Balance is the sum. |
| calls | id, call_code, caller_id, receiver_id, requested_at, accepted_at, connected_at, ended_at, duration_sec, end_reason, mode, charged_amount | Call records. Call code is the random public ID. |
| reports | id, call_id, reporter_id, reported_id, reason, note, status, handled_by, created_at | Abuse reports. |
| blocks | id, blocker_id, blocked_id, created_at | Block pairs. |
| bans | id, user_id, device_id, reason, until, created_by | Suspensions and bans. |
| admin_users | id, email, password_hash, totp_secret_encrypted, role | Admin and moderator accounts. |
| audit_logs | id, admin_id, action, target, before_json, after_json, created_at | Every admin action. |

**Indexes:** unique on auth_identities(type, value_hash); on calls(caller_id, created_at); on reports(status, created_at); on wallet_entries(user_id, created_at); on blocks(blocker_id, blocked_id).

**Retention (defaults, admin editable):** call metadata 90 days, resolved reports 12 months, OTP records 24 hours, audit logs 24 months. Deleted accounts are anonymized: identity fields erased, financial ledger rows kept without personal data where the law requires it.

## 3.7 API Design

REST for account and admin actions, Socket.IO (WSS) for presence, matching and signaling. All calls use HTTPS and a bearer access token except the public ones.

### REST endpoints

| **Method and path** | **Purpose** | **Auth** |
| --- | --- | --- |
| GET /config/public | Enabled login methods, billing mode, rates, plan list, terms versions | None |
| POST /auth/register | Create account (email) with age and terms confirmation | None |
| POST /auth/login | Email and password login | None |
| POST /auth/otp/request | Send OTP to mobile (only if enabled) | None, rate limited |
| POST /auth/otp/verify | Verify OTP, create or log in user | None, rate limited |
| POST /auth/verify-email | Confirm email code or link | None |
| POST /auth/forgot-password and /auth/reset-password | Password reset by email | None |
| POST /auth/refresh and /auth/logout | Rotate token, end session | Refresh token |
| DELETE /me | Delete account | User |
| PUT /me/availability | Turn Available on or off (saved on the server) | User |
| POST /me/devices and DELETE /me/devices/:id | Register or refresh the push token, remove it on logout | User |
| GET /me/wallet | Balance, plan, free minutes | User |
| GET /plans | Available plans | User |
| POST /reports | Report a call by call code | User |
| POST /blocks and GET /blocks | Block caller, list own blocks, unblock by DELETE /blocks/:id | User |
| GET /turn-credentials | Short-lived TURN credentials (also sent on match) | User |
| POST /admin/auth/login (+ TOTP) | Admin login | None |
| GET and PUT /admin/settings | Read and update settings | Admin |
| CRUD /admin/plans | Manage plans | Admin |
| GET /admin/users and PATCH /admin/users/:id | Search, suspend, ban, view | Admin |
| POST /admin/users/:id/wallet and /subscription | Manual credit, debit, grant plan (reason required) | Admin |
| GET and PATCH /admin/reports | Review queue and actions | Admin |
| GET /admin/dashboard | Counts, minutes, online users | Admin |
| GET /admin/audit-logs | Admin actions | Admin |

### Socket events

| **Event** | **Direction** | **Meaning** |
| --- | --- | --- |
| presence:hello | client to server | App connected, so the user is reachable on the fast path (no push needed). |
| call:request | client to server | Caller presses Call. |
| call:incoming {callCode, ringSeconds} | server to client | Anonymous incoming call to receiver with a live connection. |
| push: incoming_call {callCode} | server to phone (FCM) | High-priority data message that wakes a background or closed app. |
| call:accept and call:decline | client to server | Receiver response. |
| call:matched {callCode, turn} | server to both | Call set up. Includes ephemeral TURN credentials. |
| signal:offer, signal:answer, signal:ice | both ways via server | WebRTC negotiation. |
| call:connected | client to server | Audio is flowing. Starts the server timer. |
| billing:warning and billing:balance | server to client | Low balance and updated balance. |
| call:end and call:ended {reason} | both ways | End call and reason. |
| call:none-available | server to caller | No one accepted. |

## 3.8 Screen Design (Wireframe Descriptions)

| **Screen** | **Content and behaviour** |
| --- | --- |
| Splash and config | Logo, loads public config. Shows maintenance message if the server asks. |
| Login or Register | Tabs or buttons for Email and Mobile. Only enabled methods appear. Checkbox: I am 18 or older, I accept Terms and Privacy Policy. |
| Verify | Enter email code or mobile OTP, resend timer. |
| Home | Large round Call button. Clear Available switch, OFF by default, with one line of explanation (when ON, you can receive anonymous calls even when the app is closed). Small status (Available on or off, wallet or plan when paid mode is on). Menu: Wallet or Plan, Blocked list, Settings, Help. |
| Searching | Animated Looking for someone, Cancel button. |
| Incoming call | Text: Someone is calling. Accept (green) and Decline (red). No identity shown. Ring countdown. Shown as a full-screen alert over the lock screen when the app is closed. |
| In call | Anonymous avatar, timer, signal indicator. Buttons: Mute, Speaker, End. Secondary: Skip, Report, Block. |
| After call | Call ended summary (duration, charge if any). Buttons: Call again, Report, Block. |
| Wallet or Plan | Shown only in paid modes. Balance or plan status, plans list, history of charges. Purchase button hidden until payments are enabled. |
| Background help | Shown once when Available is first turned on. Explains notification and battery settings so calls can reach the phone and opens the phone's settings. It does not request a battery-optimization exemption. |
| Settings | Change password, logout, delete account, privacy policy, terms, support contact. |
| Admin: Dashboard | Cards: users, online now, active calls, minutes today. Chart: calls per day. |
| Admin: Settings | Sections: Billing mode, Plans, Login methods, OTP provider, Call rules, Safety thresholds. |
| Admin: Users and Reports | Tables with search, filters, detail drawer, action buttons. |

## 3.9 Security and Privacy Design

### How anonymity is enforced

- The server never sends user IDs, emails, numbers or device data to the other user. Clients only know a random call code.
- The WebRTC policy is relay-only (iceTransportPolicy set to relay), so peers never see each other's IP address.
- Audio is encrypted end to end between the phones by WebRTC (DTLS-SRTP). The TURN server forwards encrypted packets and cannot listen. The server does not record audio.
- No call audio, transcripts or recordings are stored.
- Reports use the call code. Only the backend and admin can map it to an account.

### Application security

| **Area** | **Control** |
| --- | --- |
| Passwords | Argon2id or bcrypt hashing, minimum length, breach-safe rules, lockout after repeated failures. |
| Tokens | Access token about 15 minutes. Refresh token rotating, stored hashed, revocable. |
| Transport | TLS 1.2 or higher on Nginx. Secure WebSocket only. HSTS. |
| Input and API | Validation on every endpoint, rate limiting (login, OTP, call request, report), security headers, CORS limited to the admin domain. |
| Personal data | Email and mobile stored encrypted with a key in environment secrets or AWS SSM Parameter Store. Lookups by hash. |
| Admin | Separate admin accounts, TOTP two-factor, role based access, audit log, admin panel on a path or subdomain with login rate limit. |
| Push | Push messages carry only a type and a random call code, never identity. Push tokens are removed on logout and on account deletion. When Available is OFF the token is kept but never used for calls. |
| TURN | REST ephemeral credentials valid a few minutes per call. Block private network ranges to prevent relay abuse. Cap bandwidth per session. |
| Server | Security group: SSH only from your IP, ports 80, 443, 3478 and 5349 open, a limited UDP relay port range (for example 49152 to 50000). Automatic security updates. No database port exposed. |
| Secrets | Never in the repository. Environment file with restricted permissions or SSM Parameter Store. |
| Abuse and fraud | Device fingerprint bans, per-account call limits, report-based auto suspension, billing only on server time. |

# 4. Development Phase

## 4.1 Repositories and Folder Structure

Three repositories keep builds and deployments simple. A monorepo is also fine for a single developer.

```
  calling-backend/            NestJS API + Socket.IO
    src/auth  src/users  src/config  src/matching  src/calls
    src/billing  src/safety  src/admin  src/common
    migrations/  test/  Dockerfile
 
  calling-admin/              React (Vite) admin panel
    src/pages  src/components  src/api
 
  calling-mobile/             React Native (TypeScript)
    src/screens  src/navigation  src/services/(api, socket, webrtc)
    src/store  src/components  android/
 
  infra/                      server setup files
    docker-compose.yml  nginx.conf  turnserver.conf
    backup.sh  deploy.sh  .env.example
```

## 4.2 Coding Standards

- TypeScript everywhere with strict mode. ESLint and Prettier enforced in CI.
- Backend modules by feature. Controllers stay thin. Business rules live in services.
- All input validated with DTO classes. All money and minute changes go through the billing service only.
- No secrets, personal data or audio in logs. Mask email and mobile values.
- Database changes only through migrations, never manual edits on the server.
- Mobile: separate service layers for API, socket and WebRTC. UI components contain no business rules.
- Every public function that handles billing, matching or auth has unit tests.
- Conventional commit messages (feat, fix, chore) and small pull requests.

## 4.3 Git Strategy

| **Branch** | **Purpose** | **Rules** |
| --- | --- | --- |
| main | Production-ready code | Protected. Merge by pull request only. Tagged for each release. |
| develop | Integration branch | All feature branches merge here after CI passes. |
| feature/* | One task or story | Branch from develop, delete after merge. |
| hotfix/* | Urgent production fix | Branch from main, merge to main and develop. |

## 4.4 Key Technical Decisions for Developers

| **Topic** | **Decision** | **Reason** |
| --- | --- | --- |
| WebRTC library | react-native-webrtc with Opus audio | Standard, maintained, works with React Native Android. |
| Audio routing | react-native-incall-manager for speaker and earpiece | Handles audio mode and proximity. |
| Permissions (Android) | RECORD_AUDIO, INTERNET, MODIFY_AUDIO_SETTINGS, POST_NOTIFICATIONS, USE_FULL_SCREEN_INTENT (incoming call alert), and a microphone foreground service while in a call | Needed for reliable calls and for current Android rules. Check current Play requirements for the full-screen and foreground service declarations. |
| Closed-app wake-up | Firebase Cloud Messaging high-priority data messages and a background message handler in @react-native-firebase/messaging | Free and the standard way to wake a closed Android app. |
| Incoming call alert | Notifee full-screen notification with ringtone and Accept and Decline actions (react-native-callkeep is an alternative) | Shows over the lock screen like a normal call. |
| Battery settings | No battery-exemption permission. A help screen opens the phone's app settings. | That permission is restricted by Play policy for most apps. |
| Signaling | Socket.IO over WSS | Simple reconnect handling and rooms. |
| State in app | Redux Toolkit or Zustand | Predictable state for call and auth. |
| Settings storage | settings table with JSON values and a short in-memory cache in the backend | Admin changes apply without redeploy. |
| Scheduling | In-process timers for call billing ticks, with state recovered from the database after a restart | No extra services on a small server. |
| Payment module | Interface: verifyPurchase(), grant(), refund(). MVP uses ManualProvider. | Later add GooglePlayProvider or RazorpayProvider. |
| OTP module | Interface: sendOtp(target). Providers swapped by admin setting. | Avoids lock-in and keeps SMS cost under admin control. |

## 4.5 Sprint Plan with Tasks

| **Sprint** | **Backend** | **Mobile** | **Admin and infra** |
| --- | --- | --- | --- |
| 0 | Repo setup, NestJS skeleton, PostgreSQL, migrations | React Native project, navigation, theme | EC2, security group, Nginx, domain, HTTPS, CI skeleton |
| 1 | Register, login, email verify, tokens, settings and public config API | Login and Register screens, token storage, config load | Admin login, settings page shell |
| 2 (3 weeks) | Socket server, availability API, device tokens, FCM sending, matching engine with push fallback, locks, ring and retry, unreachable marking | Home with Available switch, FCM and Notifee incoming alert (app open, background and closed), background help screen, Searching screen | Dashboard counters including users with Available on, Firebase project setup |
| 3 | Signaling events, TURN credentials, call lifecycle, server timer | WebRTC audio, in-call controls, Skip, network handling | coturn install and tests on mobile data |
| 4 | Plans, wallet ledger, billing modes, balance warnings, reports, blocks, bans | Wallet or Plan screen, Report, Block, 18+ and terms | Plans CRUD, manual credit, reports queue |
| 5 | OTP module (off by default), rate limits, account deletion, audit logs, retention jobs | Mobile login UI, delete account, polish | Users page, billing and login settings, audit log view |
| 6 | Bug fixing, load test fixes, backup script | Release build, Play listing assets, push tests on several phone brands | Monitoring, billing alarm, production deploy, closed test |

## 4.6 Definition of Done

- Code reviewed and merged by pull request, CI green (lint, unit tests, build).
- Acceptance criteria of the story demonstrated on a real Android device and on mobile data where calling is involved.
- No new secrets or personal data in logs. Migration included if the database changed.
- Documentation or API notes updated.

# 5. Testing Phase

## 5.1 Test Strategy

| **Level** | **What is tested** | **Tools** |
| --- | --- | --- |
| Unit | Matching rules, billing calculations, auth, settings, rate limits | Jest |
| Integration | REST endpoints, database, socket events, wallet ledger | Jest with Supertest, test database |
| End to end (mobile) | Register, login, call, skip, report, block | Detox or Maestro on an Android emulator, plus manual device tests |
| Calling quality | Audio on Wi-Fi, 4G, switching networks, TURN over TCP and TLS | Manual tests on at least 3 real devices and 2 carriers |
| Admin panel | Settings changes, bans, reports, 2FA | Playwright or manual checklist |
| Load | Concurrent sockets and calls on the free server | k6 or Artillery with simulated sockets, plus real call sampling |
| Security | Auth bypass, injection, rate limits, TURN abuse, privacy leaks | OWASP checklist, ZAP scan, manual review |
| Compatibility | Android 8 to latest, small and large screens, low-RAM devices, push delivery with battery saver on and on at least 3 phone brands | Emulators and real devices |

## 5.2 Entry and Exit Criteria

- Entry: build deployed to a staging server (same setup as production) and test data prepared.
- Exit: no open critical or high defects, all must-have requirements passed, load and security tests completed with documented results.

## 5.3 Core Test Cases

| **ID** | **Scenario** | **Expected result** |
| --- | --- | --- |
| TC-01 | Register with valid email and age confirmation | Account created, verification email sent, cannot call until verified. |
| TC-02 | Register without 18+ confirmation | Blocked with a clear message. |
| TC-03 | Login with wrong password five times | Temporary lockout, no account information leaked. |
| TC-04 | Admin disables mobile login | Mobile option disappears in app after config refresh. OTP endpoint rejects requests. |
| TC-05 | Admin enables mobile login with provider keys | Mobile option shown. OTP sent and verified. Daily cap respected. |
| TC-06 | Two available users, A presses Call | B receives anonymous incoming screen. No identity data in A or B payloads. |
| TC-07 | B declines | Server tries another eligible user or shows none-available to A. No charge. |
| TC-08 | B does not answer for ring time | Treated as decline. |
| TC-09 | Accept and talk for 2 minutes on mobile data | Audio clear both ways, relay candidates only, timer correct. |
| TC-10 | Network switch Wi-Fi to 4G mid-call | Call recovers within reconnect window or ends cleanly. |
| TC-11 | Network drops longer than reconnect window | Call ends, billing stops at server-known end time. |
| TC-12 | Skip pressed | Current call ends, new Call request starts, previous partner not matched again within the cooldown. |
| TC-13 | Block someone then call repeatedly | Blocked pair never matches either way. |
| TC-14 | Report with reason | Report stored with call code mapped to the reported user, visible in admin queue. |
| TC-15 | Reports exceed threshold in window | User auto-suspended, admin notified in dashboard. |
| TC-16 | FREE mode | Calls work for any verified user, no wallet entries. |
| TC-17 | SUBSCRIPTION mode without plan | Call button leads to plan screen. After admin grants a plan, calls work until the plan ends. |
| TC-18 | PER_MINUTE mode with low balance | Warning near the end, call ends when funds run out, ledger sums to the balance. |
| TC-19 | Admin changes mode during an active call | Current call continues under the old mode. New calls use the new mode. |
| TC-20 | Client tampers with timer or sends fake connected event | Server timer and ledger are unaffected. |
| TC-21 | Account deletion | Identity data removed or anonymized, tokens revoked, cannot log in. |
| TC-22 | Server restarts during a call | Presence is rebuilt on reconnect. Orphan calls are closed and billed only to the last confirmed tick. |
| TC-23 | Use TURN credentials after expiry | Allocation rejected. |
| TC-24 | Admin tries a protected action without 2FA or role | Denied and logged. |
| TC-25 | New account | Available is OFF. The user is never selected for calls until they turn it on. |
| TC-26 | Available ON, app swiped away (closed), another user presses Call | Full-screen incoming alert with ringtone appears within about 5 seconds of the push. Accept opens the app and the call connects. |
| TC-27 | Phone locked and screen off, Available ON | Alert shows over the lock screen. Accept and Decline both work. |
| TC-28 | Available turned OFF (also while a search is in progress) | User is not selected and no push is sent. Takes effect immediately. |
| TC-29 | App uninstalled or push token invalid | Server marks the user unreachable and moves to the next user within the ring time. No error shown to the caller. |
| TC-30 | Battery saver on, and on phones from at least 3 brands | Behaviour and delay documented. Help screen is reachable and opens the right settings page. |
| TC-31 | Inspect push payload | Contains only a type and a call code. No identity or personal data. |
| TC-32 | Logout or account deletion | Push token removed and no further pushes are sent. |

## 5.4 Load Test Plan

- Goal: confirm Assumption A6 (about 200 connected users and 50 simultaneous calls) on the real instance type.
- Steps: ramp socket connections to 50, 100, 200, 300. Simulate matching, accept and call lifecycle. Run 50 real relayed audio streams or a TURN stress test.
- Measure: matching time, memory (including swap use), CPU and credit balance, database connections, TURN bandwidth.
- Pass: matching under 3 seconds at 200 users, memory below about 85 percent without heavy swapping, no crashes for 1 hour.
- If it fails: tune settings first, then move to the next larger instance (see Section 7.5).

## 5.5 Security Test Plan

- OWASP API Top 10 checks on all REST and socket events (broken authorization, mass assignment, rate limit gaps).
- Privacy test: capture all payloads for two test users and confirm no identity or IP of the other user appears anywhere.
- TURN abuse test: confirm it cannot be used as an open relay without valid credentials, and cannot reach private network addresses.
- Brute force and OTP abuse tests on login and OTP endpoints.
- Dependency scan (npm audit) and container or OS update check before each release.

## 5.6 Defect Severity

| **Severity** | **Meaning** | **Example** | **Target fix** |
| --- | --- | --- | --- |
| Critical | Privacy leak, wrong charges, data loss, app unusable | Other user's ID visible, wallet double charge | Before release |
| High | Core feature broken | Calls cannot connect on mobile data | Before release |
| Medium | Feature partly broken, workaround exists | Speaker toggle fails on one device model | Next sprint |
| Low | Cosmetic | Alignment issue | Backlog |

# 6. Deployment Phase

## 6.1 AWS Free Tier Deployment Guide

> **Check first.** Open the AWS Billing console, then Free Tier, and note which plan your account is on and when it ends. Create the budget alert (Step 1) before anything else.

### Step 1. Account safety

- Enable MFA on the AWS root account. Create an admin IAM user for daily work.
- Create an AWS Budget with a USD 1 alert (email) and enable billing alerts.
- Choose the Mumbai region (ap-south-1) for low latency in India.

### Step 2. Launch the instance

- Instance type: t3.micro or t2.micro (whichever your free tier lists as eligible). OS: Ubuntu Server LTS.
- Storage: up to 30 GB gp3 or gp2 (free tier limit). Encrypt the volume.
- Key pair for SSH. Keep the .pem file safe and never commit it.
- Allocate and attach an Elastic IP so the address does not change after a restart.

### Step 3. Security group (firewall)

| **Port** | **Protocol** | **Source** | **Use** |
| --- | --- | --- | --- |
| 22 | TCP | Your IP only | SSH administration |
| 80 | TCP | Anywhere | HTTP, certificate issue and redirect to HTTPS |
| 443 | TCP | Anywhere | HTTPS, WSS, admin panel |
| 3478 | TCP and UDP | Anywhere | TURN |
| 5349 | TCP | Anywhere | TURN over TLS |
| 49152 to 50000 | UDP | Anywhere | TURN relay port range (keep it small) |

### Step 4. Prepare the server

```
  sudo apt update && sudo apt -y upgrade
  # 2 GB swap file (protects a 1 GB RAM server)
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  # Install: Docker + Compose plugin, Nginx, certbot, ufw (optional)
  # Enable unattended security updates
  sudo apt -y install unattended-upgrades
```

### Step 5. Domain and HTTPS

- Create a free DuckDNS subdomain (or use your own domain) and point it to the Elastic IP.
- Install a free Let's Encrypt certificate with certbot and set automatic renewal.
- Nginx: serve the admin panel static files at /, proxy /api to the NestJS backend, proxy /socket.io with WebSocket upgrade headers.

### Step 6. Services on the server

| **Service** | **How it runs** | **Memory tip** |
| --- | --- | --- |
| PostgreSQL | Docker container or system package, data on the EBS volume | Set shared_buffers about 64MB, max_connections about 30. |
| NestJS backend | Docker or PM2, restart always | Set Node max old space size around 256 to 300 MB. |
| coturn | System package or Docker host network, REST ephemeral credentials, relay-only config | Small footprint. Restrict relay port range and block private IP ranges. |
| Nginx | System package | Very small. |
| Admin panel | Static files built in CI, copied to the Nginx folder | No process needed. |

### Step 7. coturn essentials

```
  # /etc/turnserver.conf (key lines)
  listening-port=3478
  tls-listening-port=5349
  min-port=49152
  max-port=50000
  use-auth-secret
  static-auth-secret=<long random secret shared with the backend>
  realm=<your-domain>
  fingerprint
  no-multicast-peers
  no-cli
  # deny private ranges so TURN cannot reach internal networks
  denied-peer-ip=10.0.0.0-10.255.255.255
  denied-peer-ip=172.16.0.0-172.31.255.255
  denied-peer-ip=192.168.0.0-192.168.255.255
  denied-peer-ip=127.0.0.0-127.255.255.255
  cert=/etc/letsencrypt/live/<domain>/fullchain.pem
  pkey=/etc/letsencrypt/live/<domain>/privkey.pem
```

The backend creates a temporary username and password for each call from the shared secret. The mobile app sets the ICE policy to relay only. Test the setup on real mobile data from two different carriers before launch.

### Step 8. Environment variables (example names)

| **Variable** | **Purpose** |
| --- | --- |
| DATABASE_URL | PostgreSQL connection |
| JWT_ACCESS_SECRET and JWT_REFRESH_SECRET | Token signing |
| DATA_ENCRYPTION_KEY | Encrypt email and mobile values |
| TURN_URLS and TURN_SECRET | TURN addresses and shared secret |
| SMTP_HOST, SMTP_USER, SMTP_PASS | Verification emails |
| ADMIN_BOOTSTRAP_EMAIL | First admin creation (removed after first use) |
| SENTRY_DSN | Error tracking |

## 6.2 CI/CD Pipeline

| **Stage** | **Action** |
| --- | --- |
| Pull request | Install, lint, unit tests, build for backend, admin and mobile. |
| Merge to develop | Deploy to a staging setup (a second small environment or a local Docker test) for testing. |
| Release tag on main | Build Docker image or bundle, copy to EC2 over SSH, run database migrations, restart services, run a health check, roll back automatically if the health check fails. |
| Mobile release | GitHub Actions builds a signed Android App Bundle (AAB). Upload to Play Console manually for the first releases. |

Store the SSH deploy key and signing keys in GitHub Secrets. Keep the Android upload keystore backed up in two safe places, because losing it makes updates difficult.

## 6.3 Release Checklist: Google Play

> Play policies and requirements change often. Check the current Play Console help pages before submission. The points below are the items most likely to matter.

| **Item** | **Action** | **Done** |
| --- | --- | --- |
| Developer account | Register a Play developer account (one-time fee). Check whether closed testing with a minimum number of testers for a minimum number of days is currently required for new personal accounts, and plan time for it. | [ ] |
| Target API level | Build with the target API level that Play requires at submission time. | [ ] |
| App bundle | Signed AAB with Play App Signing enabled. | [ ] |
| Store listing | Name, short and full description, icon, feature graphic, phone screenshots, contact email. | [ ] |
| Privacy policy URL | Public page matching the Data Safety form (see Appendix A). | [ ] |
| Data safety form | Declare data collected (email, mobile, device ID, call metadata), encryption in transit, deletion option. | [ ] |
| Content rating | Complete the questionnaire honestly. User-to-user communication affects the rating. | [ ] |
| User generated content | Show in-app Report and Block, and a way to contact support. Terms prohibit abuse. | [ ] |
| Account deletion | In-app deletion plus a web page for deletion requests. | [ ] |
| Permissions | Explain microphone use. Request it only when needed. Declare the microphone foreground service type if used. | [ ] |
| Full-screen alert | Declare and justify the full-screen intent permission for incoming calls in Play Console. Check the current rules for newer Android versions. | [ ] |
| Notifications | Ask for notification permission when the user first turns Available on, with a clear explanation. | [ ] |
| Payments | If you sell plans or minutes inside the app, use Google Play Billing for these digital goods. Leave the purchase button hidden until it is integrated. | [ ] |
| Age restriction | Target audience 18 and above. | [ ] |
| Testing | Closed test or internal test with real users, crash-free check in Play Console. | [ ] |
| Support | Grievance or support contact visible in the app and on the listing. | [ ] |

## 6.4 Go-live Checklist

- Billing alarm active and tested. Free-tier end date noted in your calendar.
- Backups running and one restore tested on a clean machine.
- Admin 2FA enabled and the bootstrap admin variable removed.
- Default settings reviewed: billing mode FREE, mobile login OFF, ring time, retry count, report threshold.
- Closed-app incoming call test done with the app swiped away, on at least 3 phone brands, with battery saver on and off.
- Privacy policy, terms and grievance contact live at public URLs.
- Rollback plan: previous Docker image and database backup available.

# 7. Maintenance and Operations

## 7.1 Monitoring and Alerts

| **What** | **How** | **Alert when** |
| --- | --- | --- |
| App crashes and errors | Sentry free plan in backend, admin and mobile | New or frequent errors |
| Server health | CloudWatch basic metrics or a light agent, plus a free uptime checker on /health | Down for more than 2 minutes, CPU credits low, memory high, disk above 80 percent |
| Data transfer | Monthly review in Billing, free tier usage page | Above 70 percent of the free allowance |
| Call quality | Count of calls ended by network drop, average connect time | Failure rate rises above the usual level |
| Push delivery | Pushes sent, accepts after push, unreachable marks, FCM errors | Accept rate after push drops or FCM errors rise |
| Safety | Report count per day, auto suspensions | Sudden spike in reports |
| SMS cost (when enabled) | Daily SMS count in admin dashboard | Near the admin daily cap |

## 7.2 Backup and Recovery

- Daily database dump (pg_dump), compressed and encrypted, copied off the server (S3 free tier or another storage). Keep 7 daily and 4 weekly copies.
- Take an EBS snapshot before each major release (check snapshot storage against the free allowance).
- Keep a one-page rebuild script and infra folder so a new server can be created in under 2 hours.
- Test a restore once a month. Target recovery point: under 24 hours of data loss. Target recovery time: under 4 hours.

## 7.3 Routine Tasks

| **Frequency** | **Task** |
| --- | --- |
| Daily | Review reports queue and dashboard. |
| Weekly | Check error tracker, disk space, backups succeeded, and dependency alerts. |
| Monthly | Apply OS and package updates, review AWS usage, test a restore, review admin accounts and audit log. |
| Every release | Run the regression test list, update release notes and version codes. |
| Yearly or on policy change | Review privacy policy, terms and store policy compliance. |

## 7.4 Incident Response

| **Step** | **Action** |
| --- | --- |
| 1. Detect | Alert, user complaint, or dashboard anomaly. |
| 2. Assess | Decide severity: privacy or security incident (highest), service down, partial failure, minor. |
| 3. Contain | For abuse or security issues: ban accounts, rotate secrets, block IPs, or turn off the affected feature using admin settings. For outages: restart service or roll back the release. |
| 4. Fix and recover | Patch, redeploy, restore from backup if needed. |
| 5. Communicate | Notify affected users where required. Data breaches may carry legal notification duties, so take legal advice. |
| 6. Review | Write a short post-incident note: cause, impact, fix, prevention. |

## 7.5 Scale-up Path (when the free server is not enough)

| **Trigger** | **Step** |
| --- | --- |
| Memory or CPU credits regularly exhausted | Move to a larger instance such as t3.small or t3.medium. Same setup, bigger size. |
| Database load or backup risk | Move PostgreSQL to a managed database (Amazon RDS) or a separate server. |
| More than one backend instance needed | Add Redis for presence and the matching queue, and a load balancer with sticky WebSocket sessions. |
| High TURN bandwidth | Move coturn to its own server or consider a managed TURN provider. |
| Revenue available | Enable payments (Section 7.6) and fund infrastructure from income. |

## 7.6 Roadmap after the MVP

| **Phase** | **Features** |
| --- | --- |
| Phase 2 | Google Play Billing or Razorpay for plans and credits, quiet hours for the Available switch (for example automatic off at night), call-quality feedback, referral or promo codes set by admin. |
| Phase 3 | iOS release (closed-app calls on iPhone need Apple's CallKit and PushKit and an Apple developer account), interest or language preferences (kept anonymous), improved moderation tools, optional consented safety clip for reports (needs legal review). |
| Phase 4 | Video calls, scale to multiple servers, analytics, localization. |

# 8. Appendices

## Appendix A. Privacy Policy Outline

> These outlines are starting points, not legal advice. Have a lawyer familiar with Indian data protection and intermediary rules review the final texts before public launch.

- Who we are and how to contact us (including the grievance officer).
- What we collect: email or mobile number, password hash, device identifiers, push notification token, Available setting, call metadata (times, duration, end reason), reports and blocks, wallet and plan records, crash data.
- What we do not collect: call audio, call content, contacts, location, other users' identities.
- Why we collect it: account security, matching, billing, safety and abuse prevention, legal duties.
- How calls are protected: encrypted audio, relay through our server, no recording, no identity shared between users.
- Who we share data with: hosting provider, email or SMS provider, crash tracking, and authorities where the law requires.
- How long we keep data (retention table from Section 3.6).
- User rights: access, correction, deletion, withdrawal of consent, how to request them, and in-app account deletion.
- Children: the service is for adults 18 and above, and how we respond when we learn of an underage user.
- Changes to the policy and the version and date shown.

## Appendix B. Terms of Service Outline

- Eligibility: 18 or older, one account per person, accurate information.
- Acceptable use: no harassment, hate, threats, sexual or explicit content, scams, impersonation, illegal activity, recording of other users without consent, or use of bots.
- Safety tools and enforcement: reports, blocks, suspensions, bans and appeals.
- Anonymity rules: users must not try to identify or trace other users or ask for personal details to stalk or harass.
- Receiving calls: users receive calls only while their Available switch is on, and may decline, block or report any call.
- Plans, credits and charges (when enabled): prices, per-minute rules, refunds policy, changes with notice.
- Availability and no guarantee of call quality or match.
- Limitation of liability, governing law and dispute resolution.
- Contact and grievance process.

## Appendix C. Compliance Notes

| **Area** | **Note** |
| --- | --- |
| India data protection | The Digital Personal Data Protection Act 2023 and its rules apply to personal data of users in India. Keep consent records, allow deletion and correction, minimize data, and check the current phased obligations. |
| Intermediary rules | Apps connecting users may be treated as intermediaries under Indian IT rules. Plan for terms of use, a grievance officer and timely handling of complaints. Take legal advice on your specific obligations. |
| SMS and DLT | Commercial SMS in India needs sender and template registration with the provider. Handle this only when mobile login is enabled. |
| Google Play policies | User generated content, account deletion, data safety, payments, permissions and target audience policies all apply. |
| Payments (later) | Check gateway KYC needs, GST or tax treatment of subscriptions and credits, and invoicing rules with an accountant before collecting money. |

## Appendix D. Admin Settings Reference

| **Setting key** | **Values** | **Default** |
| --- | --- | --- |
| billing.mode | FREE, SUBSCRIPTION, PER_MINUTE | FREE |
| billing.per_minute_rate | Amount per started minute | 0 |
| billing.min_balance | Minimum balance to start a call | 0 |
| billing.free_trial_minutes | Minutes given to new users in paid modes | 0 |
| billing.free_daily_minutes | Daily limit in FREE mode (0 means unlimited) | 0 |
| login.email_enabled | true or false | true |
| login.mobile_enabled | true or false | false |
| login.otp_provider and key | Provider name and API credentials | none |
| login.sms_daily_cap | Max OTP SMS per day | 0 |
| call.ring_seconds | Ring time before decline | 30 |
| push.unreachable_minutes | Time to skip a user after failed push attempts | 60 |
| call.max_attempts | Receivers tried per request | 3 |
| call.max_duration_minutes | Call limit (0 means none) | 0 |
| call.rematch_cooldown_minutes | Time before the same pair can match again | 60 |
| call.reconnect_seconds | Drop window before ending | 15 |
| safety.report_threshold | Reports in window for auto suspension | 5 in 24 hours |
| retention.* | Days to keep calls, reports, logs | see Section 3.6 |

## Appendix E. Glossary

| **Term** | **Meaning** |
| --- | --- |
| WebRTC | Technology for real-time audio and video between devices over the internet. |
| STUN | Service that helps a device find its public address. |
| TURN | Relay server that forwards encrypted media when devices cannot connect directly. Used here to hide IP addresses. |
| ICE | Process of finding the best network path between two devices. |
| DTLS-SRTP | Encryption used by WebRTC for audio. |
| Signaling | Messages that let two phones set up a call through the server. |
| Presence | Whether a user is online and Available. |
| Ledger | List of immutable money or minute entries from which the balance is calculated. |
| MVP | Minimum viable product: the smallest version that delivers the core value. |
| AAB | Android App Bundle, the file format uploaded to Google Play. |
