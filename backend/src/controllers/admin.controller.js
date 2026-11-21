import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from '../db/index.js';
import { generateAdminToken } from '../utils/token.js';
import { logger } from '../utils/logger.js';
import { userSocketMap } from '../socket/userSocketMap.js';

// Schemas
const adminLoginSchema = z.object({
  email: z.string().email('Invalid email address format').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

const updateSettingSchema = z.object({
  value_json: z.record(z.any(), {
    required_error: 'value_json is required and must be an object',
  }),
});

const updateUserStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'banned'], {
    errorMap: () => ({ message: "Status must be 'active', 'suspended', or 'banned'" }),
  }),
  reason: z.string().optional(),
});

const resolveReportSchema = z.object({
  status: z.enum(['reviewed', 'resolved', 'dismissed'], {
    errorMap: () => ({ message: "Status must be 'reviewed', 'resolved', or 'dismissed'" }),
  }),
  action_taken: z.enum(['none', 'warning', 'suspension', 'ban'], {
    errorMap: () => ({ message: "action_taken must be 'none', 'warning', 'suspension', or 'ban'" }),
  }),
  note: z.string().optional(),
});

/**
 * 6.1 Admin Login
 * POST /admin/auth/login
 */
export async function adminLogin(req, res, next) {
  try {
    const validated = adminLoginSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: validated.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { email, password } = validated.data;

    // Look up administrator by email
    const { rows } = await pool.query(
      `
      SELECT id, email, password_hash, role, is_active
      FROM admin_users
      WHERE email = $1;
      `,
      [email]
    );

    if (rows.length === 0 || !rows[0].password_hash) {
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid admin credentials',
      });
    }

    const admin = rows[0];

    if (!admin.is_active) {
      return res.status(403).json({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Admin account has been deactivated',
      });
    }

    // Compare password with bcrypt
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid admin credentials',
      });
    }

    // Update last_login_at
    await pool.query(
      'UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
      [admin.id]
    );

    const token = generateAdminToken(admin);
    logger.info(`Admin logged in successfully: [ID: ${admin.id}, Email: ${admin.email}, Role: ${admin.role}]`);

    return res.status(200).json({
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
      },
      token,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 6.2 Get App Settings
 * GET /admin/settings
 */
export async function getSettings(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT key, value_json FROM app_settings ORDER BY key ASC;');

    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value_json;
    }

    return res.status(200).json(settings);
  } catch (error) {
    next(error);
  }
}

/**
 * 6.2 Update Setting
 * PUT /admin/settings/:key
 */
export async function updateSetting(req, res, next) {
  try {
    const key = req.params.key;
    const validated = updateSettingSchema.safeParse(req.body);

    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: validated.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { value_json } = validated.data;
    const adminId = req.admin.id;

    const result = await pool.query(
      `
      UPDATE app_settings
      SET value_json = $1::jsonb, updated_by = $2, updated_at = CURRENT_TIMESTAMP
      WHERE key = $3
      RETURNING key, value_json;
      `,
      [JSON.stringify(value_json), adminId, key]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        statusCode: 404,
        error: 'NotFound',
        message: `Setting key '${key}' does not exist`,
      });
    }

    logger.info(`Admin [${adminId}] updated setting '${key}'`);

    return res.status(200).json({
      message: 'Setting updated successfully',
      key,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 6.3 List & Search Users
 * GET /admin/users
 */
export async function listUsers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search.trim().toLowerCase()}%` : null;
    const status = req.query.status || null;

    let queryText = `
      SELECT 
        u.id,
        u.email,
        u.phone,
        u.status,
        u.is_available,
        COALESCE(w.balance_amount, 0.00)::text as wallet_balance,
        (SELECT COUNT(*) FROM reports r WHERE r.reported_id = u.id)::int as reports_count,
        u.created_at
      FROM users u
      LEFT JOIN wallets w ON w.user_id = u.id
      WHERE 1=1
    `;

    const params = [];

    if (search) {
      params.push(search);
      queryText += ` AND (LOWER(u.email) LIKE $${params.length} OR u.phone LIKE $${params.length})`;
    }

    if (status) {
      params.push(status);
      queryText += ` AND u.status = $${params.length}`;
    }

    // Count query
    const countParams = [...params];
    const countText = `
      SELECT COUNT(*) as total
      FROM users u
      WHERE 1=1
      ${search ? ` AND (LOWER(u.email) LIKE $1 OR u.phone LIKE $1)` : ''}
      ${status ? ` AND u.status = $${search ? 2 : 1}` : ''}
    `;

    params.push(limit);
    params.push(offset);
    queryText += ` ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length};`;

    const [{ rows: users }, { rows: countRows }] = await Promise.all([
      pool.query(queryText, params),
      pool.query(countText, countParams),
    ]);

    const total = parseInt(countRows[0]?.total || 0, 10);

    return res.status(200).json({
      users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 6.3 Update User Status (Suspend, Ban, Reactivate)
 * PATCH /admin/users/:id/status
 */
export async function updateUserStatus(req, res, next) {
  try {
    const userId = req.params.id;
    const validated = updateUserStatusSchema.safeParse(req.body);

    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: validated.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { status, reason } = validated.data;

    const result = await pool.query(
      `
      UPDATE users
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, status;
      `,
      [status, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        statusCode: 404,
        error: 'NotFound',
        message: 'User not found',
      });
    }

    logger.info(`Admin [${req.admin.id}] changed user [${userId}] status to '${status}' [Reason: ${reason || 'N/A'}]`);

    return res.status(200).json({
      message: `User status updated to ${status}`,
      user_id: userId,
      status,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 6.4 List Reports
 * GET /admin/reports
 */
export async function listReports(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;

    let queryText = `
      SELECT 
        r.id,
        cs.call_code,
        r.reporter_id,
        r.reported_id,
        r.reason,
        r.note,
        r.status,
        r.action_taken,
        r.created_at
      FROM reports r
      JOIN call_sessions cs ON cs.id = r.call_session_id
      WHERE 1=1
    `;

    const params = [];

    if (status) {
      params.push(status);
      queryText += ` AND r.status = $${params.length}`;
    }

    const countParams = [...params];
    const countText = `
      SELECT COUNT(*) as total
      FROM reports r
      WHERE 1=1
      ${status ? ` AND r.status = $1` : ''}
    `;

    params.push(limit);
    params.push(offset);
    queryText += ` ORDER BY r.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length};`;

    const [{ rows: reports }, { rows: countRows }] = await Promise.all([
      pool.query(queryText, params),
      pool.query(countText, countParams),
    ]);

    const total = parseInt(countRows[0]?.total || 0, 10);

    return res.status(200).json({
      reports,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 6.4 Resolve Report
 * PATCH /admin/reports/:id
 */
export async function resolveReport(req, res, next) {
  try {
    const reportId = req.params.id;
    const validated = resolveReportSchema.safeParse(req.body);

    if (!validated.success) {
      return res.status(400).json({
        statusCode: 400,
        error: 'BadRequest',
        message: validated.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { status, action_taken, note } = validated.data;
    const adminId = req.admin.id;

    const result = await pool.query(
      `
      UPDATE reports
      SET 
        status = $1,
        action_taken = $2,
        note = COALESCE($3, note),
        handled_by = $4,
        resolved_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING id, status, reported_id;
      `,
      [status, action_taken, note || null, adminId, reportId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        statusCode: 404,
        error: 'NotFound',
        message: 'Report not found',
      });
    }

    const report = result.rows[0];

    // If action taken is suspension or ban, apply to user immediately
    if (action_taken === 'suspension') {
      await pool.query("UPDATE users SET status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [report.reported_id]);
      logger.info(`User ${report.reported_id} suspended based on resolution of report ${reportId}`);
    } else if (action_taken === 'ban') {
      await pool.query("UPDATE users SET status = 'banned', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [report.reported_id]);
      logger.info(`User ${report.reported_id} banned based on resolution of report ${reportId}`);
    }

    logger.info(`Admin [${adminId}] resolved report [${reportId}] with action '${action_taken}'`);

    return res.status(200).json({
      message: 'Report resolved successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 6.5 Admin Dashboard Statistics
 * GET /admin/stats
 */
export async function getStats(req, res, next) {
  try {
    const [
      totalUsersRes,
      availableUsersRes,
      activeCallsRes,
      todayCallsRes,
      todayConnectedRes,
      todayMinutesRes,
      todayRevenueRes,
      pendingReportsRes,
      bannedUsersRes,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM users;'),
      pool.query("SELECT COUNT(*) as count FROM users WHERE is_available = TRUE AND status = 'active';"),
      pool.query("SELECT COUNT(*) as count FROM call_sessions WHERE status IN ('requested', 'ringing', 'connected');"),
      pool.query("SELECT COUNT(*) as count FROM call_sessions WHERE created_at >= CURRENT_DATE;"),
      pool.query("SELECT COUNT(*) as count FROM call_sessions WHERE connected_at >= CURRENT_DATE;"),
      pool.query("SELECT COALESCE(SUM(duration_seconds), 0) as seconds FROM call_sessions WHERE created_at >= CURRENT_DATE;"),
      pool.query("SELECT COALESCE(SUM(amount_charged), 0.00)::text as revenue FROM call_sessions WHERE created_at >= CURRENT_DATE;"),
      pool.query("SELECT COUNT(*) as count FROM reports WHERE status = 'pending';"),
      pool.query("SELECT COUNT(*) as count FROM users WHERE status = 'banned';"),
    ]);

    const totalMinutes = Math.floor(parseInt(todayMinutesRes.rows[0].seconds, 10) / 60);

    return res.status(200).json({
      overview: {
        total_registered_users: parseInt(totalUsersRes.rows[0].count, 10),
        active_users_today: parseInt(todayConnectedRes.rows[0].count, 10), // Users engaged in calls today
        currently_online_sockets: userSocketMap.getOnlineCount(),
        currently_available_users: parseInt(availableUsersRes.rows[0].count, 10),
        active_calls_now: parseInt(activeCallsRes.rows[0].count, 10),
      },
      today_metrics: {
        total_calls_initiated: parseInt(todayCallsRes.rows[0].count, 10),
        total_connected_calls: parseInt(todayConnectedRes.rows[0].count, 10),
        total_call_minutes: totalMinutes,
        total_revenue: todayRevenueRes.rows[0].revenue || '0.00',
      },
      safety_metrics: {
        pending_reports_count: parseInt(pendingReportsRes.rows[0].count, 10),
        banned_users_count: parseInt(bannedUsersRes.rows[0].count, 10),
      },
    });
  } catch (error) {
    next(error);
  }
}
