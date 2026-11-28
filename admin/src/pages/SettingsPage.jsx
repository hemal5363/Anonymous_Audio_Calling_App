import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiClient } from '../api/client.js';
import { API_ENDPOINTS } from '../api/endpoints.js';

// Canonical Tab Order and Display Labels
const CANONICAL_GROUPS = [
  { id: 'system', label: 'System' },
  { id: 'auth', label: 'Auth & OTP' },
  { id: 'matching', label: 'Matching & Calls' },
  { id: 'billing', label: 'Billing' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'limits', label: 'Limits' },
  { id: 'retention', label: 'Retention' },
  { id: 'legal', label: 'Legal & Text' },
];

// Presets for Same-Peer Rematch Cooldown
const COOLDOWN_PRESETS = [
  { label: '0 (Disabled)', value: 0 },
  { label: '30s', value: 30 },
  { label: '60s (Default)', value: 60 },
  { label: '5 min', value: 300 },
  { label: '30 min', value: 1800 },
];

/**
 * Format timestamp in Asia/Kolkata timezone (YYYY-MM-DD HH:mm:ss IST)
 */
function formatIST(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const map = {};
    parts.forEach((p) => {
      map[p.type] = p.value;
    });
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} IST`;
  } catch {
    return String(dateStr);
  }
}

/**
 * Safe value stringifier for diff display
 */
function formatValueDisplay(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

export function SettingsPage() {
  // Main settings data from GET /admin/settings
  const [settingsList, setSettingsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Status data from GET /admin/settings/status
  const [systemStatus, setSystemStatus] = useState({
    sms_provider_configured: false,
    environment: 'development',
  });

  // Active tab selection
  const [activeTab, setActiveTab] = useState('system');

  // Pending unsaved edits: { [key]: pendingValue }
  const [pendingChanges, setPendingChanges] = useState({});

  // Client validation errors: { [key]: errorMessage }
  const [clientErrors, setClientErrors] = useState({});

  // Server error messages per key: { [key]: errorMessage }
  const [serverErrors, setServerErrors] = useState({});

  // Status banners / toasts
  const [saving, setSaving] = useState(false);
  const [saveBanner, setSaveBanner] = useState(null); // { type: 'success'|'error'|'warning', message: '' }
  const [resettingKey, setResettingKey] = useState(null);

  // Critical change confirmation modal state
  const [showCriticalModal, setShowCriticalModal] = useState(false);
  const [criticalItems, setCriticalItems] = useState([]);

  // Settings History State
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyPagination, setHistoryPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [historyFilterKey, setHistoryFilterKey] = useState('');
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');

  // Map of settings by key for instant lookup
  const settingsByKey = useMemo(() => {
    const map = new Map();
    settingsList.forEach((s) => map.set(s.key, s));
    return map;
  }, [settingsList]);

  // Discover all tabs dynamically
  const tabs = useMemo(() => {
    const presentGroups = new Set();
    settingsList.forEach((s) => {
      if (s.group) presentGroups.add(s.group);
    });

    const ordered = [];
    // 1. Canonical tabs that exist
    CANONICAL_GROUPS.forEach((cg) => {
      if (presentGroups.has(cg.id)) {
        ordered.push(cg);
        presentGroups.delete(cg.id);
      }
    });

    // 2. Any unknown future groups appear as extra tabs
    Array.from(presentGroups).sort().forEach((extraId) => {
      const formattedLabel = extraId
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      ordered.push({ id: extraId, label: formattedLabel });
    });

    // 3. Always append History tab
    ordered.push({ id: 'history', label: 'History' });
    return ordered;
  }, [settingsList]);

  // Fetch settings & system status
  const fetchSettingsAndStatus = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [settingsData, statusData] = await Promise.all([
        apiClient.get(API_ENDPOINTS.SETTINGS),
        apiClient.get(API_ENDPOINTS.SETTINGS_STATUS).catch(() => ({
          sms_provider_configured: false,
          environment: 'development',
        })),
      ]);

      const items = Array.isArray(settingsData)
        ? settingsData
        : Array.isArray(settingsData?.settings)
        ? settingsData.settings
        : [];

      setSettingsList(items);
      setSystemStatus(statusData || { sms_provider_configured: false, environment: 'development' });
    } catch (err) {
      setLoadError(err.message || 'Failed to load system settings from server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettingsAndStatus();
  }, [fetchSettingsAndStatus]);

  // Warn before leaving if unsaved changes exist
  const unsavedCount = Object.keys(pendingChanges).length;
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (unsavedCount > 0) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [unsavedCount]);

  // Fetch audit history
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('page', String(historyPagination.page));
      queryParams.set('limit', String(historyPagination.limit));
      if (historyFilterKey) {
        queryParams.set('key', historyFilterKey);
      }
      if (historyStartDate) {
        queryParams.set('start_date', historyStartDate);
      }
      if (historyEndDate) {
        queryParams.set('end_date', historyEndDate);
      }

      const endpoint = `${API_ENDPOINTS.SETTINGS_HISTORY}?${queryParams.toString()}`;
      const data = await apiClient.get(endpoint);

      let rows = Array.isArray(data?.history) ? data.history : [];

      // Also apply client-side date range filtering as a safeguard
      if (historyStartDate) {
        const startTs = new Date(`${historyStartDate}T00:00:00`).getTime();
        rows = rows.filter((r) => new Date(r.created_at).getTime() >= startTs);
      }
      if (historyEndDate) {
        const endTs = new Date(`${historyEndDate}T23:59:59.999`).getTime();
        rows = rows.filter((r) => new Date(r.created_at).getTime() <= endTs);
      }

      setHistoryItems(rows);
      if (data?.pagination) {
        setHistoryPagination((prev) => ({
          ...prev,
          total: data.pagination.total ?? rows.length,
          totalPages: data.pagination.totalPages ?? 1,
        }));
      }
    } catch (err) {
      setHistoryError(err.message || 'Failed to fetch settings audit history.');
    } finally {
      setHistoryLoading(false);
    }
  }, [historyPagination.page, historyPagination.limit, historyFilterKey, historyStartDate, historyEndDate]);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab, fetchHistory]);

  // Validate a single setting value
  const validateField = (item, val) => {
    if (val === undefined) return null;

    if (item.type === 'integer') {
      if (val === '' || val === null || val === undefined) return 'Integer value is required.';
      const num = Number(val);
      if (isNaN(num) || !Number.isInteger(num)) return 'Must be a valid integer.';
      if (item.min !== null && num < item.min) return `Minimum allowed value is ${item.min}.`;
      if (item.max !== null && num > item.max) return `Maximum allowed value is ${item.max}.`;
    }

    if (item.type === 'float') {
      if (val === '' || val === null || val === undefined) return 'Numeric value is required.';
      const num = Number(val);
      if (isNaN(num)) return 'Must be a valid number.';
      if (item.min !== null && num < item.min) return `Minimum allowed value is ${item.min}.`;
      if (item.max !== null && num > item.max) return `Maximum allowed value is ${item.max}.`;
    }

    if (item.type === 'string') {
      const str = String(val ?? '');
      if (item.min !== null && str.length < item.min) return `Must be at least ${item.min} characters.`;
      if (item.max !== null && str.length > item.max) return `Must be at most ${item.max} characters.`;
      if (item.key === 'min_supported_mobile_version') {
        if (!/^\d+\.\d+\.\d+$/.test(str)) return 'Must follow SemVer format (e.g. 1.0.0).';
      }
      if (item.key.includes('_url')) {
        if (!str.startsWith('https://') && !str.startsWith('market://')) {
          return 'URL must start with https:// or market://';
        }
      }
    }

    if (item.type === 'array' && item.key === 'subscription_plans') {
      if (!Array.isArray(val) || val.length === 0) {
        return 'At least one subscription plan is required.';
      }
      for (let i = 0; i < val.length; i++) {
        const p = val[i];
        if (!p.name || !String(p.name).trim()) return `Plan #${i + 1}: Name is required.`;
        if (p.price === '' || isNaN(Number(p.price)) || Number(p.price) < 0) {
          return `Plan #${i + 1}: Price must be a non-negative number.`;
        }
        if (p.duration_days === '' || isNaN(Number(p.duration_days)) || Number(p.duration_days) < 1) {
          return `Plan #${i + 1}: Duration must be at least 1 day.`;
        }
      }
    }

    return null;
  };

  // Handle value change for a setting
  const handleValueChange = (key, rawValue) => {
    const item = settingsByKey.get(key);
    if (!item) return;

    let parsedVal = rawValue;
    if (item.type === 'integer') {
      parsedVal = rawValue === '' ? '' : parseInt(rawValue, 10);
    } else if (item.type === 'float') {
      parsedVal = rawValue === '' ? '' : parseFloat(rawValue);
    } else if (item.type === 'boolean') {
      parsedVal = Boolean(rawValue);
    }

    // Client-side validation check
    const error = validateField(item, parsedVal);
    setClientErrors((prev) => {
      const next = { ...prev };
      if (error) {
        next[key] = error;
      } else {
        delete next[key];
      }
      return next;
    });

    // Check if the new value equals the original server current_value
    const isSameAsCurrent =
      item.type === 'array'
        ? JSON.stringify(parsedVal) === JSON.stringify(item.current_value)
        : parsedVal === item.current_value;

    setPendingChanges((prev) => {
      const next = { ...prev };
      if (isSameAsCurrent) {
        delete next[key];
      } else {
        next[key] = parsedVal;
      }
      return next;
    });

    // Clear server error when user modifies the field
    setServerErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // Discard all unsaved changes
  const handleDiscardAll = () => {
    setPendingChanges({});
    setClientErrors({});
    setServerErrors({});
    setSaveBanner({ type: 'info', message: 'All unsaved changes have been discarded.' });
  };

  // Identify critical changes that require confirmation modal
  const checkCriticalChanges = () => {
    const criticals = [];

    // 1. maintenance_mode_enabled
    if (pendingChanges.maintenance_mode_enabled !== undefined) {
      const oldVal = settingsByKey.get('maintenance_mode_enabled')?.current_value;
      const newVal = pendingChanges.maintenance_mode_enabled;
      if (oldVal !== newVal) {
        criticals.push({
          key: 'maintenance_mode_enabled',
          label: 'Maintenance Mode',
          oldVal: String(oldVal),
          newVal: String(newVal),
          warning: newVal
            ? 'Enabling maintenance mode will disconnect non-admin users and reject all incoming calls and logins.'
            : 'Disabling maintenance mode will restore public access to all users.',
        });
      }
    }

    // 2. monetization_mode
    if (pendingChanges.monetization_mode !== undefined) {
      const oldVal = settingsByKey.get('monetization_mode')?.current_value;
      const newVal = pendingChanges.monetization_mode;
      if (oldVal !== newVal) {
        criticals.push({
          key: 'monetization_mode',
          label: 'Platform Monetization Mode',
          oldVal: String(oldVal),
          newVal: String(newVal),
          warning: `Switching mode from "${oldVal}" to "${newVal}" changes billing requirements for all new calls.`,
        });
      }
    }

    // 3. min_supported_mobile_version
    if (pendingChanges.min_supported_mobile_version !== undefined) {
      const oldVal = settingsByKey.get('min_supported_mobile_version')?.current_value;
      const newVal = pendingChanges.min_supported_mobile_version;
      if (oldVal !== newVal) {
        criticals.push({
          key: 'min_supported_mobile_version',
          label: 'Minimum Supported Mobile Version',
          oldVal: String(oldVal),
          newVal: String(newVal),
          warning: `Mobile clients with versions below ${newVal} will be forced to update immediately.`,
        });
      }
    }

    // 4. user_registration_enabled set to false
    if (pendingChanges.user_registration_enabled === false) {
      const oldVal = settingsByKey.get('user_registration_enabled')?.current_value;
      if (oldVal === true) {
        criticals.push({
          key: 'user_registration_enabled',
          label: 'User Registration Enabled',
          oldVal: 'true',
          newVal: 'false',
          warning: 'Disabling user registration will block all new users from creating accounts.',
        });
      }
    }

    // 5. any Limits group value lowered by more than half (newValue < oldValue / 2)
    Object.entries(pendingChanges).forEach(([key, newVal]) => {
      const item = settingsByKey.get(key);
      if (item && item.group === 'limits') {
        const oldVal = Number(item.current_value);
        const numNew = Number(newVal);
        if (!isNaN(oldVal) && !isNaN(numNew) && oldVal > 0 && numNew < oldVal / 2) {
          criticals.push({
            key,
            label: item.label,
            oldVal: String(oldVal),
            newVal: String(numNew),
            warning: `Lowering this limit from ${oldVal} to ${numNew} (by more than 50%) may immediately throttle active traffic.`,
          });
        }
      }
    });

    return criticals;
  };

  // Trigger Save All flow
  const handleInitiateSave = () => {
    // 1. Check client validation errors
    const errors = {};
    Object.entries(pendingChanges).forEach(([key, val]) => {
      const item = settingsByKey.get(key);
      if (item) {
        const err = validateField(item, val);
        if (err) errors[key] = err;
      }
    });

    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      setSaveBanner({
        type: 'error',
        message: 'Please resolve client-side validation errors before saving.',
      });
      return;
    }

    // 2. Check critical changes
    const criticals = checkCriticalChanges();
    if (criticals.length > 0) {
      setCriticalItems(criticals);
      setShowCriticalModal(true);
      return;
    }

    // 3. Execute save directly
    executeSaveAll();
  };

  // Perform actual PUT requests per key
  const executeSaveAll = async () => {
    setShowCriticalModal(false);
    setSaving(true);
    setSaveBanner(null);

    const keysToSave = Object.keys(pendingChanges);
    const succeeded = [];
    const failed = [];
    const newServerErrors = {};

    for (const key of keysToSave) {
      const val = pendingChanges[key];
      try {
        await apiClient.put(API_ENDPOINTS.SETTING_BY_KEY(key), { value: val });
        succeeded.push(key);
      } catch (err) {
        failed.push(key);
        newServerErrors[key] = err.message || 'Failed to update setting.';
      }
    }

    setServerErrors(newServerErrors);

    // Update pending changes: remove succeeded keys, keep failed keys
    setPendingChanges((prev) => {
      const next = { ...prev };
      succeeded.forEach((k) => delete next[k]);
      return next;
    });

    // Refresh settings from server to sync all latest values and overridden markers
    await fetchSettingsAndStatus();

    setSaving(false);

    if (failed.length === 0) {
      setSaveBanner({
        type: 'success',
        message: `Successfully saved ${succeeded.length} setting(s). All updates are live.`,
      });
    } else {
      setSaveBanner({
        type: 'warning',
        message: `Saved ${succeeded.length} setting(s). Failed to save ${failed.length} setting(s): see field errors below.`,
      });
    }
  };

  // Reset a setting to default via DELETE /admin/settings/:key
  const handleResetSetting = async (key) => {
    const item = settingsByKey.get(key);
    if (!item) return;

    setResettingKey(key);
    setSaveBanner(null);
    try {
      const result = await apiClient.delete(API_ENDPOINTS.SETTING_BY_KEY(key));
      // Clear pending change & error for this key
      setPendingChanges((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setClientErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setServerErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      // Update in local settings list
      setSettingsList((prev) =>
        prev.map((s) =>
          s.key === key
            ? {
                ...s,
                current_value: result.default_value !== undefined ? result.default_value : s.default,
                is_overridden: false,
              }
            : s
        )
      );

      setSaveBanner({
        type: 'success',
        message: `Reset "${item.label}" to default value (${formatValueDisplay(item.default)}).`,
      });
    } catch (err) {
      setSaveBanner({
        type: 'error',
        message: `Failed to reset "${item.label}": ${err.message}`,
      });
    } finally {
      setResettingKey(null);
    }
  };

  // Determine effective monetization mode for conditional dimming
  const effectiveMonetizationMode =
    pendingChanges.monetization_mode !== undefined
      ? pendingChanges.monetization_mode
      : settingsByKey.get('monetization_mode')?.current_value || 'free';

  // Render Loading State
  if (loading && settingsList.length === 0) {
    return (
      <div className="settings-page-container">
        <div className="auth-loading-screen" style={{ height: '60vh' }}>
          <div className="auth-spinner"></div>
          <p>Loading platform configuration settings...</p>
        </div>
      </div>
    );
  }

  // Render Critical Load Error State
  if (loadError && settingsList.length === 0) {
    return (
      <div className="settings-page-container">
        <div className="settings-error-card">
          <div className="error-icon">⚠️</div>
          <h3>Unable to Load Settings</h3>
          <p>{loadError}</p>
          <button type="button" className="btn-primary" onClick={fetchSettingsAndStatus}>
            🔄 Retry Loading Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page-container">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Platform Settings</h1>
          <p className="page-subtitle">
            Configure system parameters, monetization, matching thresholds, moderation limits, and compliance URLs.
          </p>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={fetchSettingsAndStatus}
            disabled={saving || loading}
            title="Reload settings from database"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Global Save / Feedback Banner */}
      {saveBanner && (
        <div className={`settings-banner banner-${saveBanner.type}`}>
          <span className="banner-icon">
            {saveBanner.type === 'success' && '✓'}
            {saveBanner.type === 'error' && '✕'}
            {saveBanner.type === 'warning' && '⚠'}
            {saveBanner.type === 'info' && 'ℹ'}
          </span>
          <span className="banner-text">{saveBanner.message}</span>
          <button
            type="button"
            className="banner-close-btn"
            onClick={() => setSaveBanner(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Horizontal Scrolling Tabs */}
      <div className="settings-tabs-wrapper">
        <div className="settings-tabs-container">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`settings-tab-btn ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Tab Content */}
      <div className="settings-tab-content">
        {activeTab === 'history' ? (
          <HistoryTab
            historyItems={historyItems}
            loading={historyLoading}
            error={historyError}
            pagination={historyPagination}
            settingsByKey={settingsByKey}
            filterKey={historyFilterKey}
            startDate={historyStartDate}
            endDate={historyEndDate}
            onFilterKeyChange={(k) => {
              setHistoryFilterKey(k);
              setHistoryPagination((p) => ({ ...p, page: 1 }));
            }}
            onStartDateChange={(d) => {
              setHistoryStartDate(d);
              setHistoryPagination((p) => ({ ...p, page: 1 }));
            }}
            onEndDateChange={(d) => {
              setHistoryEndDate(d);
              setHistoryPagination((p) => ({ ...p, page: 1 }));
            }}
            onPageChange={(newPage) => {
              setHistoryPagination((p) => ({ ...p, page: newPage }));
            }}
            onRefresh={fetchHistory}
          />
        ) : (
          <GroupSettingsTab
            groupId={activeTab}
            settingsList={settingsList.filter((s) => s.group === activeTab)}
            pendingChanges={pendingChanges}
            clientErrors={clientErrors}
            serverErrors={serverErrors}
            systemStatus={systemStatus}
            resettingKey={resettingKey}
            effectiveMonetizationMode={effectiveMonetizationMode}
            onValueChange={handleValueChange}
            onResetSetting={handleResetSetting}
          />
        )}
      </div>

      {/* Sticky Unsaved Changes Bar */}
      {unsavedCount > 0 && (
        <div className="sticky-unsaved-bar">
          <div className="unsaved-info">
            <span className="unsaved-badge">{unsavedCount}</span>
            <span>
              Unsaved change{unsavedCount > 1 ? 's' : ''} pending review and deployment.
            </span>
          </div>
          <div className="unsaved-actions">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleDiscardAll}
              disabled={saving}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={handleInitiateSave}
              disabled={saving || Object.keys(clientErrors).length > 0}
            >
              {saving ? 'Deploying Changes...' : `Save All (${unsavedCount})`}
            </button>
          </div>
        </div>
      )}

      {/* Critical Changes Confirmation Modal */}
      {showCriticalModal && (
        <div className="modal-backdrop">
          <div className="modal-card modal-critical">
            <div className="modal-header">
              <span className="modal-icon-warning">⚠️</span>
              <h3 className="modal-title">Confirm Critical System Changes</h3>
            </div>
            <div className="modal-body">
              <p>
                The following modifications involve sensitive platform behaviors, billing modes, or service limits. Please review them carefully before deploying:
              </p>
              <div className="critical-items-list">
                {criticalItems.map((item) => (
                  <div key={item.key} className="critical-item-card">
                    <div className="critical-item-header">
                      <strong>{item.label}</strong>
                      <code className="key-code">{item.key}</code>
                    </div>
                    <div className="critical-diff-row">
                      <span className="diff-badge diff-old">Previous: {item.oldVal}</span>
                      <span className="diff-arrow">→</span>
                      <span className="diff-badge diff-new">New: {item.newVal}</span>
                    </div>
                    <p className="critical-warning-text">{item.warning}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCriticalModal(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={executeSaveAll}
                disabled={saving}
              >
                {saving ? 'Applying...' : 'Confirm & Save All Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Settings Tab Component for a specific group
 */
function GroupSettingsTab({
  groupId,
  settingsList,
  pendingChanges,
  clientErrors,
  serverErrors,
  systemStatus,
  resettingKey,
  effectiveMonetizationMode,
  onValueChange,
  onResetSetting,
}) {
  return (
    <div className="settings-group-tab">
      {/* Special Read-Only Fields and Informational Banners */}
      {groupId === 'billing' && (
        <div className="settings-card info-card" style={{ marginBottom: '16px' }}>
          <div className="setting-header">
            <div>
              <div className="setting-title-row">
                <span className="setting-label">Platform Currency</span>
                <span className="badge badge-neutral">INR (fixed)</span>
                <span className="badge badge-private">Private</span>
              </div>
              <p className="setting-help">Platform billing operates exclusively in Indian Rupee (INR) by policy.</p>
            </div>
          </div>
        </div>
      )}

      {groupId === 'legal' && (
        <div className="settings-card info-card" style={{ marginBottom: '16px' }}>
          <div className="setting-header">
            <div>
              <div className="setting-title-row">
                <span className="setting-label">Minimum Registration Age</span>
                <span className="badge badge-neutral">18 (fixed by policy)</span>
                <span className="badge badge-public">Public</span>
              </div>
              <p className="setting-help">Age requirement fixed at 18+ by platform safety and legal policy.</p>
            </div>
          </div>
        </div>
      )}

      {/* Render all settings in this group */}
      {settingsList.map((item) => {
        // Special rendering for subscription_plans array table editor
        if (item.key === 'subscription_plans') {
          const isDimmed = effectiveMonetizationMode !== 'subscription';
          return (
            <SubscriptionPlansEditor
              key={item.key}
              item={item}
              currentValue={pendingChanges[item.key] !== undefined ? pendingChanges[item.key] : item.current_value}
              isOverridden={
                pendingChanges[item.key] !== undefined
                  ? JSON.stringify(pendingChanges[item.key]) !== JSON.stringify(item.default)
                  : item.is_overridden
              }
              isDimmed={isDimmed}
              effectiveMode={effectiveMonetizationMode}
              clientError={clientErrors[item.key]}
              serverError={serverErrors[item.key]}
              isResetting={resettingKey === item.key}
              onChange={(val) => onValueChange(item.key, val)}
              onReset={() => onResetSetting(item.key)}
            />
          );
        }

        // Conditional dimming for per-minute billing fields when mode is not per_minute
        const isDimmedPerMinute =
          groupId === 'billing' &&
          (item.key === 'billing_rate_per_minute' || item.key === 'billing_minimum_balance') &&
          effectiveMonetizationMode !== 'per_minute';

        return (
          <SettingRow
            key={item.key}
            item={item}
            pendingValue={pendingChanges[item.key]}
            clientError={clientErrors[item.key]}
            serverError={serverErrors[item.key]}
            systemStatus={systemStatus}
            isResetting={resettingKey === item.key}
            isDimmed={isDimmedPerMinute}
            effectiveMode={effectiveMonetizationMode}
            onChange={(val) => onValueChange(item.key, val)}
            onReset={() => onResetSetting(item.key)}
          />
        );
      })}
    </div>
  );
}

/**
 * Single Setting Row Component
 */
function SettingRow({
  item,
  pendingValue,
  clientError,
  serverError,
  systemStatus,
  isResetting,
  isDimmed,
  effectiveMode,
  onChange,
  onReset,
}) {
  const currentValue = pendingValue !== undefined ? pendingValue : item.current_value;

  // Check if overridden compared to default
  const isOverridden =
    pendingValue !== undefined
      ? pendingValue !== item.default
      : item.is_overridden;

  // Is at default value right now (for reset button disable state)
  const isAtDefault = currentValue === item.default && !item.is_overridden;

  // Amber warning conditions
  let amberWarning = null;
  if (item.key === 'cooldown_same_peer_seconds' && Number(currentValue) > 3600) {
    amberWarning = 'High values increase waiting time when few users are online.';
  } else if (item.key === 'ring_timeout_seconds' && Number(currentValue) > 60) {
    amberWarning = 'High ring timeout may cause callers to wait too long for unresponsive peers.';
  } else if (item.key === 'max_call_duration_seconds' && Number(currentValue) < 600) {
    amberWarning = 'Short call duration (< 10 minutes) may prematurely truncate conversations.';
  }

  // Mobile login SMS provider check
  const isMobileLogin = item.key === 'mobile_login_enabled';
  const isProd = systemStatus.environment === 'production';
  const smsConfigured = Boolean(systemStatus.sms_provider_configured);
  const mobileLoginDisabledByEnv = isMobileLogin && isProd && !smsConfigured;

  return (
    <div className={`settings-card setting-row-card ${isDimmed ? 'settings-card-dimmed' : ''}`}>
      <div className="setting-header">
        <div className="setting-info">
          <div className="setting-title-row">
            <span className="setting-label">{item.label}</span>
            <code className="key-code">{item.key}</code>

            {/* Scope Badge */}
            <span className={`badge ${item.public ? 'badge-public' : 'badge-private'}`}>
              {item.public ? 'Public' : 'Private'}
            </span>

            {/* Overridden Marker */}
            {isOverridden && (
              <span className="badge badge-overridden" title="Setting has custom value different from factory default">
                Overridden
              </span>
            )}

            {/* Inactive Mode Dimming Badge */}
            {isDimmed && (
              <span className="badge badge-neutral" title="Inactive under current monetization mode">
                Inactive in {effectiveMode} mode
              </span>
            )}
          </div>

          <p className="setting-help">{item.help}</p>

          {/* Min / Max / Default Badge */}
          <div className="setting-metadata-row">
            <span className="metadata-badge">
              {item.min !== null && item.min !== undefined && `Min ${item.min} | `}
              {item.max !== null && item.max !== undefined && `Max ${item.max} | `}
              Default: {formatValueDisplay(item.default)}
              {item.unit ? ` (${item.unit})` : ''}
            </span>

            {/* SMS Provider Status Badge for mobile_login_enabled */}
            {isMobileLogin && (
              <span
                className={`sms-status-badge ${smsConfigured ? 'sms-configured' : 'sms-not-configured'}`}
              >
                {smsConfigured ? '✓ SMS gateway: configured' : '⚠ SMS gateway: not configured'}
              </span>
            )}
          </div>
        </div>

        {/* Action: Reset Button */}
        <div className="setting-reset-action">
          <button
            type="button"
            className="btn-reset"
            onClick={onReset}
            disabled={isAtDefault || isResetting}
            title={isAtDefault ? 'Already at factory default' : `Reset to default (${formatValueDisplay(item.default)})`}
          >
            {isResetting ? 'Resetting...' : 'Reset'}
          </button>
        </div>
      </div>

      {/* Control Input Area */}
      <div className="setting-control-area">
        {/* Boolean Toggle Switch */}
        {item.type === 'boolean' && (
          <div className="toggle-wrapper">
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={Boolean(currentValue)}
                disabled={mobileLoginDisabledByEnv}
                onChange={(e) => onChange(e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
            <span className="toggle-state-label">
              {currentValue ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        )}

        {/* Integer or Float Input */}
        {(item.type === 'integer' || item.type === 'float') && (
          <div className="number-input-group">
            <input
              type="number"
              className="form-control"
              value={currentValue !== undefined && currentValue !== null ? currentValue : ''}
              step={item.type === 'float' ? '0.01' : '1'}
              min={item.min !== null ? item.min : undefined}
              max={item.max !== null ? item.max : undefined}
              onChange={(e) => onChange(e.target.value)}
            />
            {item.unit && <span className="input-unit-label">{item.unit}</span>}
          </div>
        )}

        {/* Enum Select Dropdown */}
        {item.type === 'enum' && (
          <div className="select-wrapper">
            <select
              className="form-control"
              value={currentValue || ''}
              onChange={(e) => onChange(e.target.value)}
            >
              {item.key === 'monetization_mode' ? (
                <>
                  <option value="free">Free (Zero Cost)</option>
                  <option value="subscription">Subscription (Tiered Plans)</option>
                  <option value="per_minute">Per-Minute Rate (Pay-As-You-Go)</option>
                </>
              ) : (
                <option value={currentValue}>{currentValue}</option>
              )}
            </select>
          </div>
        )}

        {/* String Input */}
        {item.type === 'string' && (
          <div className="string-input-group">
            <input
              type={item.key.includes('_url') ? 'url' : 'text'}
              className="form-control"
              value={currentValue || ''}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        )}

        {/* Quick Presets for cooldown_same_peer_seconds */}
        {item.key === 'cooldown_same_peer_seconds' && (
          <div className="quick-presets-row">
            <span className="preset-label">Presets:</span>
            {COOLDOWN_PRESETS.map((p) => {
              const isSelected = Number(currentValue) === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  className={`quick-preset-btn ${isSelected ? 'active' : ''}`}
                  onClick={() => onChange(p.value)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Production SMS Error Explanation */}
        {mobileLoginDisabledByEnv && (
          <p className="field-error-text">
            Cannot enable mobile login in production: No SMS provider configured. Configure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in environment variables.
          </p>
        )}

        {/* Client Validation Error */}
        {clientError && <p className="field-error-text">{clientError}</p>}

        {/* Server Save Error */}
        {serverError && <p className="field-error-text server-error">Server rejected: {serverError}</p>}

        {/* Amber Non-Blocking Warning */}
        {amberWarning && (
          <div className="settings-amber-warning">
            <span className="warning-icon">⚠️</span>
            <span>{amberWarning}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Subscription Plans Table Editor for Billing Tab
 */
function SubscriptionPlansEditor({
  item,
  currentValue,
  isOverridden,
  isDimmed,
  effectiveMode,
  clientError,
  serverError,
  isResetting,
  onChange,
  onReset,
}) {
  const plans = Array.isArray(currentValue) ? currentValue : [];

  const handleUpdatePlan = (index, field, val) => {
    const updated = plans.map((p, idx) => {
      if (idx !== index) return p;
      return {
        ...p,
        [field]: field === 'active' ? Boolean(val) : val,
      };
    });
    onChange(updated);
  };

  const handleAddPlan = () => {
    const newPlan = {
      id: String(Date.now()),
      name: `Plan ${plans.length + 1}`,
      price: 99,
      duration_days: 30,
      active: true,
    };
    onChange([...plans, newPlan]);
  };

  const handleDeletePlan = (index) => {
    const updated = plans.filter((_, idx) => idx !== index);
    onChange(updated);
  };

  return (
    <div className={`settings-card ${isDimmed ? 'settings-card-dimmed' : ''}`}>
      <div className="setting-header">
        <div>
          <div className="setting-title-row">
            <span className="setting-label">{item.label}</span>
            <code className="key-code">{item.key}</code>
            <span className="badge badge-public">Public</span>
            {isOverridden && <span className="badge badge-overridden">Overridden</span>}
            {isDimmed && (
              <span className="badge badge-neutral">Inactive in {effectiveMode} mode</span>
            )}
          </div>
          <p className="setting-help">{item.help}</p>
        </div>
        <div className="setting-reset-action">
          <button
            type="button"
            className="btn-reset"
            onClick={onReset}
            disabled={!isOverridden || isResetting}
          >
            {isResetting ? 'Resetting...' : 'Reset'}
          </button>
        </div>
      </div>

      {/* Plans Table */}
      <div className="plans-table-container">
        <table className="plans-table">
          <thead>
            <tr>
              <th>Plan Name</th>
              <th>Price (₹ INR)</th>
              <th>Duration (Days)</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan, index) => (
              <tr key={plan.id || index}>
                <td>
                  <input
                    type="text"
                    className="form-control"
                    value={plan.name || ''}
                    placeholder="e.g. Starter Pass"
                    onChange={(e) => handleUpdatePlan(index, 'name', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="form-control"
                    value={plan.price !== undefined ? plan.price : ''}
                    min="0"
                    step="1"
                    onChange={(e) => handleUpdatePlan(index, 'price', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="form-control"
                    value={plan.duration_days !== undefined ? plan.duration_days : ''}
                    min="1"
                    step="1"
                    onChange={(e) => handleUpdatePlan(index, 'duration_days', e.target.value)}
                  />
                </td>
                <td>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={Boolean(plan.active)}
                      onChange={(e) => handleUpdatePlan(index, 'active', e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <span style={{ marginLeft: '8px', fontSize: '0.85rem' }}>
                    {plan.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-delete-row"
                    onClick={() => handleDeletePlan(index)}
                    title="Remove subscription plan"
                  >
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="plans-table-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={handleAddPlan}>
            + Add New Plan
          </button>
        </div>

        {clientError && <p className="field-error-text">{clientError}</p>}
        {serverError && <p className="field-error-text server-error">{serverError}</p>}
      </div>
    </div>
  );
}

/**
 * Settings Audit History Tab Component
 */
function HistoryTab({
  historyItems,
  loading,
  error,
  pagination,
  settingsByKey,
  filterKey,
  startDate,
  endDate,
  onFilterKeyChange,
  onStartDateChange,
  onEndDateChange,
  onPageChange,
  onRefresh,
}) {
  const allKeys = Array.from(settingsByKey.keys()).sort();

  return (
    <div className="history-tab-container">
      {/* Filters Bar */}
      <div className="history-filters-bar">
        <div className="filter-group">
          <label htmlFor="history-key-filter">Setting Key:</label>
          <select
            id="history-key-filter"
            className="form-control"
            value={filterKey}
            onChange={(e) => onFilterKeyChange(e.target.value)}
          >
            <option value="">All Settings (Show All)</option>
            {allKeys.map((k) => {
              const label = settingsByKey.get(k)?.label || k;
              return (
                <option key={k} value={k}>
                  {label} ({k})
                </option>
              );
            })}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="history-start-date">From Date:</label>
          <input
            id="history-start-date"
            type="date"
            className="form-control"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="history-end-date">To Date:</label>
          <input
            id="history-end-date"
            type="date"
            className="form-control"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
          />
        </div>

        {(filterKey || startDate || endDate) && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              onFilterKeyChange('');
              onStartDateChange('');
              onEndDateChange('');
            }}
          >
            Clear Filters
          </button>
        )}

        <button
          type="button"
          className="btn-secondary btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={onRefresh}
          disabled={loading}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="settings-banner banner-error">
          <span className="banner-icon">✕</span>
          <span className="banner-text">{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && historyItems.length === 0 ? (
        <div className="auth-loading-screen" style={{ height: '30vh' }}>
          <div className="auth-spinner"></div>
          <p>Loading settings audit history...</p>
        </div>
      ) : historyItems.length === 0 ? (
        <div className="history-empty-state">
          <p>No audit history records found matching your filters.</p>
        </div>
      ) : (
        <>
          <div className="history-table-container">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Timestamp (IST)</th>
                  <th>Admin</th>
                  <th>Setting</th>
                  <th>Value Change (Diff)</th>
                  <th>IP Address</th>
                </tr>
              </thead>
              <tbody>
                {historyItems.map((row) => {
                  const item = settingsByKey.get(row.key);
                  const label = item ? item.label : row.key;
                  return (
                    <tr key={row.id}>
                      <td className="history-timestamp">{formatIST(row.created_at)}</td>
                      <td className="history-admin">{row.admin_email || row.admin_id || 'System'}</td>
                      <td className="history-setting">
                        <strong>{label}</strong>
                        <br />
                        <code className="key-code">{row.key}</code>
                      </td>
                      <td className="history-diff">
                        <span className="diff-badge diff-old">
                          {formatValueDisplay(row.old_value)}
                        </span>
                        <span className="diff-arrow"> → </span>
                        <span className="diff-badge diff-new">
                          {formatValueDisplay(row.new_value)}
                        </span>
                      </td>
                      <td className="history-ip">{row.ip_address || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="history-pagination">
            <span>
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} total records)
            </span>
            <div className="pagination-buttons">
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={pagination.page <= 1 || loading}
                onClick={() => onPageChange(pagination.page - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={pagination.page >= pagination.totalPages || loading}
                onClick={() => onPageChange(pagination.page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default SettingsPage;
