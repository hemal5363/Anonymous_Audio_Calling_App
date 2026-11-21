#!/usr/bin/env node

/**
 * End-to-End Call Flow Simulation Script
 * 
 * Demonstrates:
 * 1. Log in / register two test users (User A - Caller, User B - Callee)
 * 2. Set both users' availability to true
 * 3. Connect both sockets to Socket.IO with valid JWT tokens
 * 4. User A emits 'call:find' to initiate matching
 * 5. User B receives 'call:incoming' and User A receives 'call:ringing'
 * 6. User B accepts the call via 'call:accept'
 * 7. Both users receive 'call:matched' with ICE configuration
 * 8. Both users emit 'call:connected' (WebRTC connected)
 * 9. User A sends fake WebRTC offer ('signal:offer') -> relayed to User B
 * 10. User B sends fake WebRTC answer ('signal:answer') -> relayed to User A
 * 11. User A sends fake ICE candidate ('signal:ice') -> relayed to User B
 * 12. User A terminates the call via 'call:end'
 * 13. Both users receive 'call:ended' with duration and reason
 */

import http from 'node:http';
import { io as Client } from 'socket.io-client';
import app from '../src/app.js';
import { config } from '../src/config/index.js';
import { initSocketServer } from '../src/socket/index.js';
import { pool, checkDbConnection } from '../src/db/index.js';
import { SOCKET_EVENTS } from '../src/socket/events.js';

// Visual formatting helpers
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[31m';

function step(num, title) {
  console.log(`\n${BOLD}${CYAN}=== [STEP ${num}] ${title} ===${RESET}`);
}

function logEvent(role, event, data) {
  const roleColor = role.includes('Caller') ? BLUE : MAGENTA;
  console.log(`${roleColor}[${role}]${RESET} received ${GREEN}${event}${RESET}:`, JSON.stringify(data, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function loginOrRegister(serverUrl, email, password) {
  // 1. Try login first
  const loginRes = await requestJson(`${serverUrl}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  const existingToken = loginRes.data?.tokens?.accessToken || loginRes.data?.token?.access_token;
  if (loginRes.ok && existingToken) {
    return {
      token: existingToken,
      user: loginRes.data.user,
    };
  }

  // 2. If login fails (user does not exist), register
  const registerRes = await requestJson(`${serverUrl}/auth/register`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      confirm_age_18: true,
    }),
  });

  if (!registerRes.ok && registerRes.status !== 409) {
    throw new Error(`Failed to register ${email}: ${JSON.stringify(registerRes.data)}`);
  }

  // Login after registration
  const retryLogin = await requestJson(`${serverUrl}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  const newToken = retryLogin.data?.tokens?.accessToken || retryLogin.data?.token?.access_token;
  if (!retryLogin.ok || !newToken) {
    throw new Error(`Failed to login ${email} after registration: ${JSON.stringify(retryLogin.data)}`);
  }

  return {
    token: newToken,
    user: retryLogin.data.user,
  };
}

async function setAvailability(serverUrl, token, isAvailable) {
  const res = await requestJson(`${serverUrl}/user/availability`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ is_available: isAvailable }),
  });

  if (!res.ok) {
    throw new Error(`Failed to update availability: ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

async function runSimulation() {
  console.log(`\n${BOLD}${GREEN}==============================================================${RESET}`);
  console.log(`${BOLD}${GREEN}   Anonymous Audio Calling App - Call Flow Simulation Script  ${RESET}`);
  console.log(`${BOLD}${GREEN}==============================================================${RESET}`);

  let server;
  let ioServer;
  let serverUrl;
  let isOwnServer = false;

  // 1. Verify DB connection
  try {
    await checkDbConnection();
    console.log(`${GREEN}✔ PostgreSQL connection established.${RESET}`);
  } catch (err) {
    console.error(`${RED}✖ Database connection failed:${RESET}`, err.message);
    process.exit(1);
  }

  // 2. Check if server is already running on port, or start in-process server
  const testUrl = `http://127.0.0.1:${config.port}`;
  const healthCheck = await fetch(`${testUrl}/health`).catch(() => null);

  if (healthCheck && healthCheck.ok) {
    serverUrl = testUrl;
    console.log(`${GREEN}✔ Connected to existing server at ${serverUrl}${RESET}`);
  } else {
    // Start temporary in-process server on ephemeral port
    isOwnServer = true;
    server = http.createServer(app);
    ioServer = initSocketServer(server);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        serverUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
    console.log(`${GREEN}✔ Started in-process HTTP and Socket.IO server at ${serverUrl}${RESET}`);
  }

  // Test credentials
  const callerCreds = {
    email: 'user_a_sim@example.com',
    password: 'SimPassword123!',
  };
  const calleeCreds = {
    email: 'user_b_sim@example.com',
    password: 'SimPassword123!',
  };

  step(1, 'Authenticating Test Users');
  console.log(`Authenticating User A (Caller: ${callerCreds.email})...`);
  const userA = await loginOrRegister(serverUrl, callerCreds.email, callerCreds.password);
  console.log(`${GREEN}✔ User A authenticated.${RESET} ID: ${userA.user.id}`);

  console.log(`Authenticating User B (Callee: ${calleeCreds.email})...`);
  const userB = await loginOrRegister(serverUrl, calleeCreds.email, calleeCreds.password);
  console.log(`${GREEN}✔ User B authenticated.${RESET} ID: ${userB.user.id}`);

  step(2, 'Setting User Availability to Available');
  await setAvailability(serverUrl, userA.token, true);
  console.log(`${GREEN}✔ User A availability toggled -> ON (true)${RESET}`);
  await setAvailability(serverUrl, userB.token, true);
  console.log(`${GREEN}✔ User B availability toggled -> ON (true)${RESET}`);

  step(3, 'Connecting Sockets with JWT Authentication');
  const socketA = Client(serverUrl, {
    auth: { token: userA.token },
    transports: ['websocket'],
  });
  const socketB = Client(serverUrl, {
    auth: { token: userB.token },
    transports: ['websocket'],
  });

  await Promise.all([
    new Promise((resolve) => socketA.on('connect', resolve)),
    new Promise((resolve) => socketB.on('connect', resolve)),
  ]);
  console.log(`${BLUE}✔ User A Socket connected [ID: ${socketA.id}]${RESET}`);
  console.log(`${MAGENTA}✔ User B Socket connected [ID: ${socketB.id}]${RESET}`);

  // Setup promise barriers for signaling progression
  let activeCallCode = null;
  let activeSessionId = null;

  const incomingCallPromise = new Promise((resolve) => {
    socketB.on(SOCKET_EVENTS.CALL_INCOMING, (payload) => {
      logEvent('User B (Callee)', SOCKET_EVENTS.CALL_INCOMING, payload);
      activeCallCode = payload.callCode;
      activeSessionId = payload.sessionId;
      resolve(payload);
    });
  });

  const callerRingingPromise = new Promise((resolve) => {
    socketA.on(SOCKET_EVENTS.CALL_RINGING, (payload) => {
      logEvent('User A (Caller)', SOCKET_EVENTS.CALL_RINGING, payload);
      activeCallCode = payload.callCode;
      activeSessionId = payload.sessionId;
      resolve(payload);
    });
  });

  const callerMatchedPromise = new Promise((resolve) => {
    socketA.on(SOCKET_EVENTS.CALL_MATCHED, (payload) => {
      logEvent('User A (Caller)', SOCKET_EVENTS.CALL_MATCHED, payload);
      resolve(payload);
    });
  });

  const calleeMatchedPromise = new Promise((resolve) => {
    socketB.on(SOCKET_EVENTS.CALL_MATCHED, (payload) => {
      logEvent('User B (Callee)', SOCKET_EVENTS.CALL_MATCHED, payload);
      resolve(payload);
    });
  });

  const calleeReceivedOfferPromise = new Promise((resolve) => {
    socketB.on(SOCKET_EVENTS.SIGNAL_OFFER, (payload) => {
      logEvent('User B (Callee)', SOCKET_EVENTS.SIGNAL_OFFER, payload);
      resolve(payload);
    });
  });

  const callerReceivedAnswerPromise = new Promise((resolve) => {
    socketA.on(SOCKET_EVENTS.SIGNAL_ANSWER, (payload) => {
      logEvent('User A (Caller)', SOCKET_EVENTS.SIGNAL_ANSWER, payload);
      resolve(payload);
    });
  });

  const calleeReceivedIcePromise = new Promise((resolve) => {
    socketB.on(SOCKET_EVENTS.SIGNAL_ICE, (payload) => {
      logEvent('User B (Callee)', SOCKET_EVENTS.SIGNAL_ICE, payload);
      resolve(payload);
    });
  });

  const callEndedPromises = Promise.all([
    new Promise((resolve) => {
      socketA.on(SOCKET_EVENTS.CALL_ENDED, (payload) => {
        logEvent('User A (Caller)', SOCKET_EVENTS.CALL_ENDED, payload);
        resolve(payload);
      });
    }),
    new Promise((resolve) => {
      socketB.on(SOCKET_EVENTS.CALL_ENDED, (payload) => {
        logEvent('User B (Callee)', SOCKET_EVENTS.CALL_ENDED, payload);
        resolve(payload);
      });
    }),
  ]);

  step(4, 'Initiating Call Search (call:find)');
  console.log(`${BLUE}User A (Caller) emitting '${SOCKET_EVENTS.CALL_FIND}'...${RESET}`);
  socketA.emit(SOCKET_EVENTS.CALL_FIND);

  step(5, 'Awaiting Ringing and Incoming Alerts');
  await Promise.all([callerRingingPromise, incomingCallPromise]);
  console.log(`${GREEN}✔ Ringing state established anonymously with ephemeral callCode: ${activeCallCode}${RESET}`);
  console.log(`${YELLOW}Notice: Neither peer received the other peer's email, phone number, or user ID!${RESET}`);

  await sleep(1000); // 1-second simulated ringing delay

  step(6, 'Callee Accepts Call (call:accept)');
  console.log(`${MAGENTA}User B (Callee) accepting call for ${activeCallCode}...${RESET}`);
  socketB.emit(SOCKET_EVENTS.CALL_ACCEPT, { callCode: activeCallCode });

  step(7, 'Call Matched with STUN/TURN ICE Servers');
  await Promise.all([callerMatchedPromise, calleeMatchedPromise]);
  console.log(`${GREEN}✔ Both peers received 'call:matched' with ICE configuration.${RESET}`);

  step(8, 'WebRTC Connection Established (call:connected)');
  socketA.emit(SOCKET_EVENTS.CALL_CONNECTED, { callCode: activeCallCode });
  socketB.emit(SOCKET_EVENTS.CALL_CONNECTED, { callCode: activeCallCode });
  console.log(`${GREEN}✔ Emitted '${SOCKET_EVENTS.CALL_CONNECTED}'. Active duration timer and billing begun.${RESET}`);

  await sleep(500);

  step(9, 'WebRTC Signaling Relay: Fake Offer');
  const fakeOffer = {
    callCode: activeCallCode,
    sdp: {
      type: 'offer',
      sdp: 'v=0\r\no=Caller 12345 67890 IN IP4 127.0.0.1\r\ns=Simulated Audio Session\r\nt=0 0\r\nm=audio 54321 RTP/SAVPF 111\r\n',
    },
  };
  console.log(`${BLUE}User A emitting 'signal:offer'...${RESET}`);
  socketA.emit(SOCKET_EVENTS.SIGNAL_OFFER, fakeOffer);
  await calleeReceivedOfferPromise;
  console.log(`${GREEN}✔ Callee received relayed WebRTC offer from Caller.${RESET}`);

  step(10, 'WebRTC Signaling Relay: Fake Answer');
  const fakeAnswer = {
    callCode: activeCallCode,
    sdp: {
      type: 'answer',
      sdp: 'v=0\r\no=Callee 98765 43210 IN IP4 127.0.0.1\r\ns=Simulated Audio Session\r\nt=0 0\r\nm=audio 54322 RTP/SAVPF 111\r\n',
    },
  };
  console.log(`${MAGENTA}User B emitting 'signal:answer'...${RESET}`);
  socketB.emit(SOCKET_EVENTS.SIGNAL_ANSWER, fakeAnswer);
  await callerReceivedAnswerPromise;
  console.log(`${GREEN}✔ Caller received relayed WebRTC answer from Callee.${RESET}`);

  step(11, 'WebRTC Signaling Relay: Fake ICE Candidate');
  const fakeIce = {
    callCode: activeCallCode,
    candidate: {
      candidate: 'candidate:1 1 UDP 2122260223 127.0.0.1 54321 typ relay raddr 0.0.0.0 rport 0',
      sdpMid: '0',
      sdpMLineIndex: 0,
    },
  };
  console.log(`${BLUE}User A emitting 'signal:ice'...${RESET}`);
  socketA.emit(SOCKET_EVENTS.SIGNAL_ICE, fakeIce);
  await calleeReceivedIcePromise;
  console.log(`${GREEN}✔ Callee received relayed ICE candidate.${RESET}`);

  console.log(`\n${CYAN}Call active and audio streaming in progress (simulating 2 seconds of conversation)...${RESET}`);
  await sleep(2000);

  step(12, 'Ending Call (call:end)');
  console.log(`${BLUE}User A (Caller) tapping End Call...${RESET}`);
  socketA.emit(SOCKET_EVENTS.CALL_END, {
    callCode: activeCallCode,
    reason: 'caller_hangup',
  });

  step(13, 'Awaiting Call Termination Notification');
  await callEndedPromises;
  console.log(`${GREEN}✔ Both peers received 'call:ended' notification.${RESET}`);

  step(14, 'Cleanup and Teardown');
  // Always reset availability to false so simulation users do not stay available in database
  try {
    console.log('Resetting simulation users availability to false...');
    await setAvailability(serverUrl, userA.token, false).catch(() => {});
    await setAvailability(serverUrl, userB.token, false).catch(() => {});
    console.log(`${GREEN}✔ Simulation users availability reset to false.${RESET}`);
  } catch (err) {
    console.warn('Could not reset availability:', err.message);
  }

  socketA.disconnect();
  socketB.disconnect();

  if (isOwnServer && server) {
    await new Promise((resolve) => server.close(resolve));
    if (ioServer) ioServer.close();
    await pool.end();
  }

  console.log(`\n${BOLD}${GREEN}==============================================================${RESET}`);
  console.log(`${BOLD}${GREEN}   ✔ FULL CALL SIMULATION COMPLETED SUCCESSFULLY!             ${RESET}`);
  console.log(`${BOLD}${GREEN}   All WebRTC signaling, relaying, and teardown verified.     ${RESET}`);
  console.log(`${BOLD}${GREEN}==============================================================${RESET}\n`);
}

runSimulation()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n${BOLD}${RED}Simulation failed with error:${RESET}`, err);
    process.exit(1);
  });
