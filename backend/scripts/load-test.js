#!/usr/bin/env node

/**
 * High-Concurrency Socket Load Test
 * 
 * Simulates N concurrent users over Socket.IO (configurable, default 100).
 * Sets them available and makes them call each other repeatedly with random accept, reject, and hang-up.
 * 
 * Invariants checked at the end:
 * 1. No user was ever in two active calls simultaneously.
 * 2. No call_sessions row is stuck in 'requested', 'ringing', or 'connected'.
 * 3. No unexpected fatal errors were logged during execution.
 * 
 * Prints summary metrics and process memory usage.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { io as Client } from 'socket.io-client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import app from '../src/app.js';
import { config } from '../src/config/index.js';
import { pool, checkDbConnection } from '../src/db/index.js';
import { initSocketServer } from '../src/socket/index.js';
import { generateAccessToken } from '../src/utils/token.js';
import { SOCKET_EVENTS } from '../src/socket/events.js';
import { runStartupRecovery } from '../src/services/cleanup.service.js';

// Configuration from CLI flags or environment variables
const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  return process.env[name.toUpperCase()] || defaultValue;
}

const NUM_USERS = parseInt(getArg('users', '100'), 10);
const DURATION_SECS = parseInt(getArg('duration', '15'), 10);
const TEST_RUN_ID = crypto.randomUUID().slice(0, 8);

// Formatting helpers
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoadTest() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}    Anonymous Audio Calling - High-Concurrency Load Test Tool         ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`Simulated Users (N): ${BOLD}${NUM_USERS}${RESET}`);
  console.log(`Duration:            ${BOLD}${DURATION_SECS} seconds${RESET}`);
  console.log(`Run Identifier:      ${BOLD}${TEST_RUN_ID}${RESET}`);

  // 1. Verify Database Connection
  try {
    await checkDbConnection();
    await runStartupRecovery();
    console.log(`${GREEN}✔ PostgreSQL connected & startup recovery completed.${RESET}`);
  } catch (err) {
    console.error(`${RED}✖ Database connection check failed:${RESET}`, err.message);
    process.exit(1);
  }

  // 2. Locate or Start Server
  let server;
  let ioServer;
  let serverUrl;
  let isOwnServer = false;

  const candidateUrl = `http://127.0.0.1:${config.port}`;
  const healthCheck = await fetch(`${candidateUrl}/health`).catch(() => null);

  if (healthCheck && healthCheck.ok) {
    serverUrl = candidateUrl;
    console.log(`${GREEN}✔ Connected to existing server at ${serverUrl}${RESET}`);
  } else {
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
    console.log(`${GREEN}✔ Started in-process server for load testing at ${serverUrl}${RESET}`);
  }

  // 3. Provision N Simulated Users and Wallets in Database
  console.log(`\nProvisioning ${NUM_USERS} simulated users in database...`);
  const users = [];

  for (let i = 0; i < NUM_USERS; i++) {
    const userId = crypto.randomUUID();
    const email = `load_${TEST_RUN_ID}_${i}@example.com`;
    const userObj = {
      id: userId,
      email,
      status: 'active',
      is_available: true,
    };
    const token = generateAccessToken(userObj);
    users.push({
      ...userObj,
      token,
      index: i,
    });
  }

  // Insert users and wallets in batches
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, email, status, is_available, available_changed_at)
         VALUES ($1, $2, 'active', TRUE, NOW())
         ON CONFLICT (id) DO UPDATE SET is_available = TRUE, status = 'active';`,
        [u.id, u.email]
      );
      await client.query(
        `INSERT INTO wallets (user_id, balance_amount, balance_minutes, free_trial_minutes)
         VALUES ($1, 100.00, 100, 10)
         ON CONFLICT (user_id) DO UPDATE SET balance_amount = 100.00;`,
        [u.id]
      );
    }
    await client.query('COMMIT');
    console.log(`${GREEN}✔ ${NUM_USERS} users and wallets successfully provisioned in database.${RESET}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`${RED}✖ Failed to seed test users:${RESET}`, err.message);
    client.release();
    process.exit(1);
  } finally {
    client.release();
  }

  // 4. Metrics & State Tracking
  const metrics = {
    callsInitiated: 0,
    callsMatched: 0,
    callsAccepted: 0,
    callsRejected: 0,
    callsCompleted: 0,
    callsCancelled: 0,
    noneAvailableCount: 0,
    errorsEncountered: 0,
  };

  const invariantViolations = [];
  const unexpectedErrors = [];

  // Track each user's active call code and client-side lifecycle state
  const userActiveCalls = new Map(); // userId -> callCode
  const userStates = new Map(); // userId -> 'idle' | 'searching' | 'ringing' | 'in_call'

  for (const u of users) {
    userStates.set(u.id, 'idle');
  }

  function recordUserCallStart(userId, callCode, eventName) {
    const existing = userActiveCalls.get(userId);
    if (existing && existing !== callCode) {
      const violation = `CRITICAL: User ${userId} received ${eventName} for ${callCode} while already in call ${existing}!`;
      invariantViolations.push(violation);
      console.error(`${RED}${BOLD}${violation}${RESET}`);
    }
    userActiveCalls.set(userId, callCode);
  }

  function recordUserCallEnd(userId, callCode) {
    const existing = userActiveCalls.get(userId);
    if (existing === callCode || !callCode) {
      userActiveCalls.delete(userId);
      userStates.set(userId, 'idle');
    }
  }

  // 5. Connect Sockets for all N Users
  console.log(`Connecting ${NUM_USERS} sockets over WebSockets...`);
  const sockets = [];
  let connectedCount = 0;

  const connectionPromises = users.map((u) => {
    return new Promise((resolve) => {
      const socket = Client(serverUrl, {
        auth: { token: u.token },
        transports: ['websocket'],
        reconnection: false,
      });

      socket.on('connect', () => {
        connectedCount++;
        resolve(socket);
      });

      socket.on('connect_error', (err) => {
        unexpectedErrors.push({ user: u.id, error: err.message });
        resolve(null);
      });

      // User state machine event handlers
      socket.on(SOCKET_EVENTS.CALL_RINGING, (data) => {
        userStates.set(u.id, 'ringing');
        recordUserCallStart(u.id, data.callCode, 'CALL_RINGING');

        // 10% chance caller cancels while ringing
        if (Math.random() < 0.1) {
          setTimeout(() => {
            if (userActiveCalls.get(u.id) === data.callCode) {
              metrics.callsCancelled++;
              socket.emit('call:cancel', { callCode: data.callCode });
            }
          }, 120);
        }
      });

      socket.on(SOCKET_EVENTS.CALL_INCOMING, (data) => {
        userStates.set(u.id, 'ringing');
        recordUserCallStart(u.id, data.callCode, 'CALL_INCOMING');

        // Callee reaction delay: 50ms - 250ms
        const delay = Math.floor(Math.random() * 200) + 50;
        setTimeout(() => {
          if (userActiveCalls.get(u.id) !== data.callCode) return;
          const rand = Math.random();
          if (rand < 0.7) {
            // 70% Accept
            metrics.callsAccepted++;
            socket.emit(SOCKET_EVENTS.CALL_ACCEPT, { callCode: data.callCode });
          } else if (rand < 0.95) {
            // 25% Reject / Decline
            metrics.callsRejected++;
            socket.emit(SOCKET_EVENTS.CALL_REJECT, { callCode: data.callCode, reason: 'declined' });
          }
          // 5% let ring timeout
        }, delay);
      });

      socket.on(SOCKET_EVENTS.CALL_MATCHED, (data) => {
        metrics.callsMatched++;
        userStates.set(u.id, 'in_call');
        recordUserCallStart(u.id, data.callCode, 'CALL_MATCHED');

        // Both emit call:connected
        socket.emit(SOCKET_EVENTS.CALL_CONNECTED, { callCode: data.callCode });

        // Simulate conversation length: 250ms - 800ms
        const callDuration = Math.floor(Math.random() * 550) + 250;
        setTimeout(() => {
          if (userActiveCalls.get(u.id) === data.callCode) {
            metrics.callsCompleted++;
            socket.emit(SOCKET_EVENTS.CALL_END, {
              callCode: data.callCode,
              reason: 'caller_hangup',
            });
          }
        }, callDuration);
      });

      socket.on(SOCKET_EVENTS.CALL_ENDED, (data) => {
        recordUserCallEnd(u.id, data?.callCode);
      });

      socket.on(SOCKET_EVENTS.CALL_NONE_AVAILABLE, () => {
        metrics.noneAvailableCount++;
        recordUserCallEnd(u.id);
      });

      socket.on(SOCKET_EVENTS.CALL_ERROR, (err) => {
        // Expected contention errors during high concurrency
        if (
          err?.error !== 'no_users_available' &&
          err?.error !== 'cooldown_active' &&
          err?.error !== 'rate_limit_exceeded' &&
          err?.error !== 'already_in_call' &&
          err?.error !== 'invalid_session' &&
          err?.error !== 'invalid_status'
        ) {
          unexpectedErrors.push(err);
        }
        if (err?.error === 'already_in_call') {
          // If already in call, keep current state
        } else {
          recordUserCallEnd(u.id);
        }
        metrics.errorsEncountered++;
      });

      sockets.push({ user: u, socket });
    });
  });

  await Promise.all(connectionPromises);
  console.log(`${GREEN}✔ All ${connectedCount}/${NUM_USERS} sockets connected successfully.${RESET}`);

  // 6. Execute Load Traffic Loop
  console.log(`\nStarting continuous call traffic for ${DURATION_SECS} seconds...`);
  const startTime = Date.now();
  const endTime = startTime + DURATION_SECS * 1000;

  const trafficInterval = setInterval(() => {
    // Select candidates who are in 'idle' state and not currently in any call
    const idleCandidates = sockets.filter(
      (s) => s.socket.connected && userStates.get(s.user.id) === 'idle' && !userActiveCalls.has(s.user.id)
    );

    const batchSize = Math.min(idleCandidates.length, Math.floor(Math.random() * 8) + 3);
    for (let b = 0; b < batchSize; b++) {
      const idx = Math.floor(Math.random() * idleCandidates.length);
      const item = idleCandidates.splice(idx, 1)[0];
      if (item) {
        userStates.set(item.user.id, 'searching');
        metrics.callsInitiated++;
        item.socket.emit(SOCKET_EVENTS.CALL_FIND);
      }
    }
  }, 250);

  // Monitor progress
  while (Date.now() < endTime) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const activeCallsCount = userActiveCalls.size / 2;
    process.stdout.write(
      `\r[${elapsed}s/${DURATION_SECS}s] Initiated: ${metrics.callsInitiated} | Matched: ${metrics.callsMatched} | Accepted: ${metrics.callsAccepted} | Completed: ${metrics.callsCompleted} | Active: ${Math.floor(activeCallsCount)} `
    );
    await sleep(500);
  }

  clearInterval(trafficInterval);
  console.log(`\n\nTraffic phase finished. Awaiting final in-flight calls to drain...`);

  // Wait 3 seconds for calls to settle
  await sleep(3000);

  // Cleanly hang up any lingering active sessions using allowed reason 'caller_hangup'
  for (const { user, socket } of sockets) {
    const activeCall = userActiveCalls.get(user.id);
    if (activeCall && socket.connected) {
      socket.emit(SOCKET_EVENTS.CALL_END, { callCode: activeCall, reason: 'caller_hangup' });
      userActiveCalls.delete(user.id);
    }
  }

  await sleep(2000);

  // Disconnect all sockets
  for (const { socket } of sockets) {
    if (socket.connected) {
      socket.disconnect();
    }
  }

  await sleep(1500);

  // 7. Verification of Invariants
  console.log(`\n${BOLD}${CYAN}--- INVARIANT VERIFICATIONS ---${RESET}`);

  // Invariant 1: No user was ever in two active calls
  const invariant1Pass = invariantViolations.length === 0;
  if (invariant1Pass) {
    console.log(`${GREEN}✔ INVARIANT 1 PASSED:${RESET} No user was ever in two active calls concurrently.`);
  } else {
    console.log(`${RED}✖ INVARIANT 1 FAILED:${RESET} Found ${invariantViolations.length} duplicate call violations!`);
  }

  // Invariant 2: No call_sessions row stuck in ringing or connected
  const { rows: stuckSessions } = await pool.query(
    `SELECT id, call_code, status, caller_id, callee_id, requested_at
     FROM call_sessions
     WHERE status IN ('requested', 'ringing', 'connected');`
  );

  const invariant2Pass = stuckSessions.length === 0;
  if (invariant2Pass) {
    console.log(`${GREEN}✔ INVARIANT 2 PASSED:${RESET} Zero call_sessions rows stuck in ringing/connected.`);
  } else {
    console.log(
      `${RED}✖ INVARIANT 2 FAILED:${RESET} Found ${stuckSessions.length} stuck call_sessions row(s):`,
      stuckSessions.map((s) => ({ callCode: s.call_code, status: s.status }))
    );
  }

  // Invariant 3: No unexpected errors logged
  const invariant3Pass = unexpectedErrors.length === 0;
  if (invariant3Pass) {
    console.log(`${GREEN}✔ INVARIANT 3 PASSED:${RESET} Zero unexpected fatal/crash errors logged.`);
  } else {
    console.log(`${YELLOW}⚠ INVARIANT 3 WARNING:${RESET} Recorded ${unexpectedErrors.length} unexpected error(s):`, unexpectedErrors.slice(0, 5));
  }

  // 8. Memory Usage & Performance Metrics
  const mem = process.memoryUsage();
  const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

  console.log(`\n${BOLD}${CYAN}--- LOAD TEST SUMMARY & SYSTEM METRICS ---${RESET}`);
  console.table({
    'Simulated Users (N)': NUM_USERS,
    'Duration (seconds)': DURATION_SECS,
    'Calls Initiated': metrics.callsInitiated,
    'Calls Matched': metrics.callsMatched,
    'Calls Accepted': metrics.callsAccepted,
    'Calls Rejected / Declined': metrics.callsRejected,
    'Calls Completed (Hung up)': metrics.callsCompleted,
    'Calls Cancelled Ringing': metrics.callsCancelled,
    'Throughput (Calls/Sec)': (metrics.callsInitiated / DURATION_SECS).toFixed(1),
  });

  console.log(`\n${BOLD}${CYAN}--- MEMORY USAGE ---${RESET}`);
  console.table({
    'RSS (Resident Set Size)': `${toMB(mem.rss)} MB`,
    'Heap Total': `${toMB(mem.heapTotal)} MB`,
    'Heap Used': `${toMB(mem.heapUsed)} MB`,
    'External C++ Buffers': `${toMB(mem.external)} MB`,
  });

  // 9. Teardown & Database Sanitization
  console.log('\nCleaning up simulated load test users from database...');
  try {
    await pool.query(
      `DELETE FROM users WHERE email LIKE $1;`,
      [`load_${TEST_RUN_ID}_%`]
    );
    console.log(`${GREEN}✔ Simulated test users purged from database.${RESET}`);
  } catch (err) {
    console.warn('Warning: Could not purge test users:', err.message);
  }

  if (isOwnServer && server) {
    await new Promise((resolve) => server.close(resolve));
    if (ioServer) ioServer.close();
  }
  await pool.end();

  const allPassed = invariant1Pass && invariant2Pass && invariant3Pass;
  if (allPassed) {
    console.log(`\n${BOLD}${GREEN}======================================================================${RESET}`);
    console.log(`${BOLD}${GREEN}  ✔ LOAD TEST COMPLETED SUCCESSFULLY! ALL INVARIANTS SATISFIED.       ${RESET}`);
    console.log(`${BOLD}${GREEN}======================================================================${RESET}\n`);
    process.exit(0);
  } else {
    console.log(`\n${BOLD}${RED}======================================================================${RESET}`);
    console.log(`${BOLD}${RED}  ✖ LOAD TEST FINISHED WITH INVARIANT FAILURES.                       ${RESET}`);
    console.log(`${BOLD}${RED}======================================================================${RESET}\n`);
    process.exit(1);
  }
}

runLoadTest().catch((err) => {
  console.error(`${RED}Fatal load test execution error:${RESET}`, err);
  process.exit(1);
});
