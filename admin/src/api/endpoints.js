/**
 * Admin API Endpoints
 * Maps to backend Express routes as defined in docs/API_SPEC.md
 */
export const API_ENDPOINTS = {
  // Auth
  LOGIN: '/admin/auth/login',
  CHANGE_PASSWORD: '/admin/auth/password',

  // Settings
  SETTINGS: '/admin/settings',
  SETTING_BY_KEY: (key) => `/admin/settings/${key}`,
  SETTINGS_HISTORY: '/admin/settings/history',
  SETTINGS_STATUS: '/admin/settings/status',

  // Users
  USERS: '/admin/users',
  USER_STATUS: (id) => `/admin/users/${id}/status`,
  USER_WALLET: (id) => `/admin/users/${id}/wallet`,

  // Abuse Reports
  REPORTS: '/admin/reports',
  REPORT_ACTION: (id) => `/admin/reports/${id}`,

  // Dashboard Stats
  STATS: '/admin/stats',

  // Call Logs & History (Admin anonymous logs)
  CALL_LOGS: '/admin/calls',
};
