# Anonymous Audio Calling App - Mobile Client

React Native (Expo) mobile application for the Anonymous Audio Calling platform.

---

## Prerequisites

1. **Node.js**: v18 or v20+ installed on your computer.
2. **Expo Go**: Install the official **Expo Go** app on your physical mobile device:
   - [Android (Google Play Store)](https://play.google.com/store/apps/details?id=host.exp.exponent)
   - [iOS (Apple App Store)](https://apps.apple.com/app/expo-go/id982107779)
3. **Local Wi-Fi Network**: Your development computer and mobile phone must be connected to the **same Wi-Fi network / subnet** so the phone can reach the backend server over LAN.

---

## Installation

1. Navigate to the `mobile` directory:
   ```bash
   cd mobile
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

---

## Configuration (`.env`)

1. Copy the example environment file:
   ```bash
   # On Windows (Command Prompt / PowerShell)
   copy .env.example .env

   # On macOS / Linux
   cp .env.example .env
   ```

2. Find your computer's local LAN IPv4 address:
   - **Windows:** Run `ipconfig` in PowerShell or Command Prompt. Look for `IPv4 Address` under your active Wi-Fi adapter (e.g. `192.168.1.9`).
   - **macOS:** Open System Settings $\rightarrow$ Wi-Fi $\rightarrow$ Details, or run `ipconfig getifaddr en0`.
   - **Linux:** Run `hostname -I` or `ip addr show`.

3. Update `.env` with your computer's LAN IP:
   ```env
   EXPO_PUBLIC_API_URL=http://<YOUR_PC_IP>:3000
   ```
   *Example:*
   ```env
   EXPO_PUBLIC_API_URL=http://192.168.1.9:3000
   ```

> **Note:**
> - Ensure your backend server is running with `HOST=0.0.0.0` and `PORT=3000` (see `backend/.env`).
> - Ensure your local firewall (such as Windows Defender Firewall) allows incoming connections on port 3000 for Private networks.

---

## Running with Expo Go

1. Start the Metro bundler:
   ```bash
   npm start
   ```
   *(Alternatively: `npx expo start` or `npx expo start --tunnel` if testing across different networks)*

2. Open the app on your phone:
   - **Android:** Open the **Expo Go** app and tap **Scan QR code**, then scan the QR code displayed in your terminal.
   - **iOS:** Open the native **Camera** app, scan the terminal QR code, and tap the banner to launch inside Expo Go.

3. **Running on Emulators (optional):**
   - Press `a` in the terminal to launch on a running Android Emulator (uses `10.0.2.2:3000` or LAN IP).
   - Press `i` in the terminal to launch on an iOS Simulator (macOS only).

---

## Key Features & Testing

- **Authentication:** Email & Password registration/login and mobile OTP support.
- **Availability Switch:** Real-time toggle on the Home screen that marks the user available for matching.
- **Socket.io Connection:** Automatically connects and authenticates via JWT upon login with polling-first transport and automatic WebSocket upgrade.
- **Anonymous Call Flow:**
  - **Searching Screen:** Initiates match with animated radar and Cancel capability.
  - **Incoming Call Screen:** Callee alert with Accept and Decline actions and 30-second ring timeout.
  - **In-Call Screen:** Real-time MM:SS timer, Mute, Speaker, Skip (instant rematch), Report Abuse, Block Peer, and End Call controls.
  - **Privacy Guarantee:** No names, emails, phones, or user IDs are displayed or leaked to peers.
- **Call Disconnect Resilience:** 5-second network grace period before concluding mid-call drops.
- **Wallet & Call History:** Displays monetization status (free, subscription, or per-minute balance) and past anonymous call records.
