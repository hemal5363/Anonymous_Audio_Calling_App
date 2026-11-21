import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/db/index.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Billing Endpoints (GET /billing/wallet, GET /billing/subscription)', () => {
  let querySpy;

  const mockUser = {
    id: 'user-uuid-8888',
    email: 'user8888@example.com',
    status: 'active',
    is_available: true,
  };

  let validToken;

  beforeEach(() => {
    validToken = generateAccessToken(mockUser);
    querySpy = jest.spyOn(pool, 'query');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /billing/wallet', () => {
    it('should return 401 when unauthenticated', async () => {
      const res = await request(app).get('/billing/wallet');
      expect(res.status).toBe(401);
    });

    it('should return wallet balance and per_minute mode when authenticated', async () => {
      // 1. Auth middleware check
      querySpy
        .mockResolvedValueOnce({ rows: [mockUser] })
        // 2. getMonetizationSettings
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'per_minute', per_minute_rate: 1.5, currency: 'INR' } }],
        })
        // 3. User wallet query
        .mockResolvedValueOnce({
          rows: [
            {
              balance_amount: '45.00',
              balance_minutes: 30,
              free_trial_minutes: 5,
              is_locked: false,
            },
          ],
        });

      const res = await request(app)
        .get('/billing/wallet')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.current_mode).toBe('per_minute');
      expect(res.body.rate_per_minute).toBe('1.5');
      expect(res.body.wallet.balance_amount).toBe('45.00');
      expect(res.body.wallet.balance_minutes).toBe(30);
      expect(res.body.wallet.free_trial_minutes).toBe(5);
    });
  });

  describe('GET /billing/subscription', () => {
    it('should return 401 when unauthenticated', async () => {
      const res = await request(app).get('/billing/subscription');
      expect(res.status).toBe(401);
    });

    it('should return active subscription and available plans when authenticated', async () => {
      const mockSub = {
        id: 'sub-uuid-1',
        plan_id: 'plan-uuid-1',
        plan_name: 'Monthly Unlimited',
        status: 'active',
        starts_at: '2026-11-01T00:00:00.000Z',
        ends_at: '2026-12-01T00:00:00.000Z',
        daily_minute_cap: 60,
      };

      const mockPlan = {
        id: 'plan-uuid-1',
        name: 'Monthly Unlimited',
        description: 'Unlimited calls for 30 days',
        price: '99.00',
        currency: 'INR',
        duration_days: 30,
        daily_minute_cap: 60,
      };

      querySpy
        // 1. Auth check
        .mockResolvedValueOnce({ rows: [mockUser] })
        // 2. getMonetizationSettings
        .mockResolvedValueOnce({
          rows: [{ value_json: { mode: 'subscription', currency: 'INR' } }],
        })
        // 3. Active subscription query
        .mockResolvedValueOnce({ rows: [mockSub] })
        // 4. Today usage seconds
        .mockResolvedValueOnce({ rows: [{ total_seconds: 1800 }] })
        // 5. Available plans query
        .mockResolvedValueOnce({ rows: [mockPlan] });

      const res = await request(app)
        .get('/billing/subscription')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.current_mode).toBe('subscription');
      expect(res.body.active_subscription).toBeDefined();
      expect(res.body.active_subscription.plan_name).toBe('Monthly Unlimited');
      expect(res.body.active_subscription.minutes_used_today).toBe(30);
      expect(res.body.available_plans).toHaveLength(1);
      expect(res.body.available_plans[0].name).toBe('Monthly Unlimited');
    });
  });
});
