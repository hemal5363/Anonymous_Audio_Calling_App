# Project Rules (always follow)

## Product
- Anonymous one-to-one random voice calling app.
- User taps Call and is connected to a random available user.
- No name, number or any identity is shown to either side.
- Audio only. Android first. MVP first.

## Accounts and login
- Users must register. Login by email and by mobile number.
- Mobile-number login can be enabled/disabled from admin settings.

## Availability
- A user is available only if their in-app Available switch is ON.
- It does not depend on whether the app is open.

## Monetization (admin controlled)
- Admin chooses: free, subscription, or per-minute charges.

## Tech stack
- Mobile: React Native with Expo (Expo Go for early development,
  Expo development build via EAS for WebRTC calling)
- Backend: Node.js + Express + Socket.io
- Calls: WebRTC (own TURN server, coturn)
- Admin: web frontend
- Hosting: AWS free-tier EC2. No extra paid services.

## Working rules
- Read docs/ before coding. Do one task at a time.
- Never hardcode secrets. Use .env files.
- Commit after every working step.
- Write simple, readable code with comments on tricky parts.
- Do not use native modules that Expo Go lacks until the
  development-build phase.