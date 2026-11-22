# Privacy Policy for Anonymous Audio Calling

**Effective Date:** November 22, 2026  
**Last Updated:** November 22, 2026  
**Version:** 1.0  

This Privacy Policy explains how **Anonymous Audio Calling** ("we", "us", or "our") collects, uses, protects, and discloses your information when you use our mobile application ("App") and associated services ("Service").

We are committed to maintaining the highest standards of user privacy, data minimization, and anonymity. This document is designed to meet Google Play Store Data Safety requirements, applicable privacy regulations, and our core platform philosophy: **Zero Peer Identity**.

---

## 1. Core Guarantee: Zero Peer Identity & No Audio Recording

### 1.1 Strict Peer Anonymity
When you place or receive a call on Anonymous Audio Calling:
* **Your identity is never disclosed to other users.** Your name, email address, phone number, and IP address are never displayed or shared with the person you talk to.
* Both caller and callee see only the moniker **"Anonymous Caller"** or **"Anonymous User"**.
* Each call is assigned an ephemeral, randomized session code that cannot be correlated by other users to your real identity.

### 1.2 No Audio Recording or Interception
* **Calls are conducted peer-to-peer using encrypted WebRTC.**
* **We DO NOT record, store, listen to, transcribe, or analyze your audio conversations.**
* Audio streams flow directly between participants' devices using end-to-end encryption (SRTP/DTLS). If a direct peer-to-peer connection cannot be established due to firewall or NAT restrictions, media packets pass through encrypted TURN relays without being decoded, saved, or inspected by our servers.
* No audio files exist on our servers, and no audio recording capabilities exist within the backend infrastructure.

---

## 2. Information We Collect

We collect only the minimum information necessary to authenticate accounts, establish connections, prevent abuse, and process optional service billing:

| Category | Specific Data Points | Purpose | Storage Method |
| :--- | :--- | :--- | :--- |
| **Account Authentication** | Email address *(optional)* or Phone number *(for SMS OTP)*, securely hashed password | Account creation, login verification, and session authentication. | Stored in PostgreSQL with bcrypt password hashing (12 salt rounds). |
| **Push Notification Token** | Expo Push Token *(random device identifier)* | To notify your device of incoming calls when the app is in the background or closed. | Stored in backend database; never shared with third parties or other users. |
| **Call Metadata** | Timestamp, duration in seconds, anonymous session ID, call termination status *(e.g. ended, declined, missed)*, billing mode *(free, subscription, per-minute)* | Connection quality monitoring, call billing/balance deduction, and service diagnostics. | Stored in database without peer identity exposure. |
| **Abuse & Safety Reports** | Caller report categories *(e.g. harassment, inappropriate conduct)*, optional freeform notes | Platform safety moderation and spam prevention. | Associated with anonymous session records for administrative review. |
| **Device & Network Data** | Ephemeral IP address *(during active connection)* | WebRTC ICE candidate signaling and rate-limiting abuse prevention. | Temporarily processed in-memory; not permanently logged or sold. |

---

## 3. How We Store and Protect Your Data

### 3.1 Mobile Device Security
* **Authentication Tokens:** On mobile devices, authentication tokens (Access Token and Refresh Token) are stored exclusively in hardware-backed secure storage via **Expo SecureStore** (Android Keystore / iOS Keychain). Tokens are **never** written to unencrypted `AsyncStorage` or exposed in client logs.
* **Release Build Hardening:** All application console logs and debugging statements are automatically stripped from production release builds.
* **Microphone Access:** Microphone permission is requested solely during active calls for real-time voice transmission. The microphone is deactivated and released immediately when a call terminates.

### 3.2 Backend Security & Access Control
* **Transport Encryption:** All API communications occur over HTTPS with TLS 1.3 encryption. Real-time signaling uses authenticated WSS (WebSockets Secure).
* **Token Rotation & Expiry:** Short-lived JWT access tokens are paired with single-use rotating refresh tokens that are immediately revoked on logout.
* **Role-Based Authorization:** Administrative routes require dedicated administrator credentials that standard user tokens cannot satisfy.
* **No Third-Party Analytics Trackers:** We do not embed third-party advertising SDKs or tracking pixels that harvest user behavioral data.

---

## 4. Permissions Requested by the App

To provide anonymous voice calling, the App requests the following permissions:

1. **Microphone (`RECORD_AUDIO`):** Required to capture your voice during active calls. You can revoke this permission at any time in device settings; however, voice calls cannot function without microphone access.
2. **Notifications (`POST_NOTIFICATIONS`):** Required to alert you when another user is calling while the App is running in the background or closed. If denied, the App functions normally when open, but background incoming call alerts will not ring.
3. **Network State (`ACCESS_NETWORK_STATE`, `INTERNET`):** Required to connect to the calling servers and relay WebRTC audio packets.

---

## 5. Data Retention Policy

* **Account Data:** Retained for the lifetime of your account.
* **Call Session Logs:** Operational call metadata is retained for 90 days for billing dispute resolution and quality auditing, after which it is archived or deleted.
* **OTP Verification Codes:** Expire automatically within 5 minutes and are purged from database records.
* **Account Deletion:** You can delete your account at any time directly within the App (**Settings & Account → Delete My Account**). Upon deletion:
  - Your email, phone number, and password hashes are permanently erased from our database.
  - All push notification tokens are deleted and unregistered.
  - Historical call records are permanently anonymized and unlinked from any identifiable information.

---

## 6. Children's Privacy

Our Service is intended exclusively for users who are **18 years of age or older**. We do not knowingly collect personal information from individuals under 18. If we become aware that a person under 18 has created an account, we will immediately terminate the account and erase their data.

---

## 7. Changes to This Privacy Policy

We may update this Privacy Policy periodically to reflect legal, technical, or operational updates. When changes occur, we will update the "Last Updated" date at the top of this document. Significant changes will be announced in-app.

---

## 8. Contact & Data Protection Officer

If you have questions, feedback, or requests regarding this Privacy Policy or your personal data, please contact our privacy team:

* **Email:** privacy@anonaudiocall.com  
* **Subject Line:** Privacy & Data Safety Inquiry  
* **Account Deletion Support:** Available in-app or via support@anonaudiocall.com  
