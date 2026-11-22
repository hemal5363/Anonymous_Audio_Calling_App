import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client.js';
import { API_ENDPOINTS } from '../api/endpoints.js';

const MODES = [
  {
    id: 'free',
    name: 'Free Mode',
    tagline: 'Zero Cost for All Callers',
    description: 'Anyone can place audio calls without wallet balance or paid plans. Free trial caps can be configured.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
        <line x1="7" y1="7" x2="7.01" y2="7"></line>
      </svg>
    ),
  },
  {
    id: 'subscription',
    name: 'Subscription',
    tagline: 'Tiered Membership Plans',
    description: 'Callers must have an active subscription package. Callee receives calls for free.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
        <line x1="1" y1="10" x2="23" y2="10"></line>
      </svg>
    ),
  },
  {
    id: 'per_minute',
    name: 'Per-Minute Rate',
    tagline: 'Pay-As-You-Go Metering',
    description: 'Requires a minimum wallet balance before dialing. Minutes are deducted dynamically every 60s.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
    ),
  },
];

const DEFAULT_PLANS = [
  { id: '1', name: 'Starter Pass', price: 49.0, duration_days: 30, daily_minute_cap: 30 },
  { id: '2', name: 'Unlimited Monthly', price: 99.0, duration_days: 30, daily_minute_cap: 0 },
];

export function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [validationErrors, setValidationErrors] = useState({});

  // Original saved values (to detect mode changes)
  const [savedSettings, setSavedSettings] = useState(null);

  // Form states
  const [monetization, setMonetization] = useState({
    mode: 'free',
    per_minute_rate: 1.0,
    currency: 'INR',
    minimum_balance: 5.0,
    free_trial_minutes_new_user: 10,
    free_daily_minute_cap: 30,
    subscription_plans: DEFAULT_PLANS,
  });

  const [authSettings, setAuthSettings] = useState({
    email_login_enabled: true,
    mobile_login_enabled: false,
    otp_expiry_seconds: 300,
    max_otp_attempts: 3,
  });

  const [matchingSettings, setMatchingSettings] = useState({
    cooldown_same_peer_seconds: 60,
    ring_timeout_seconds: 30,
    max_match_attempts: 3,
    try_live_presence_first: true,
  });

  // Admin password change form state (enforces strong admin password policy)
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Confirmation modal state for monetization mode change
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Fetch settings from backend
  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const data = await apiClient.get(API_ENDPOINTS.SETTINGS);

      const mon = data.monetization || {};
      const auth = data.auth_settings || {};
      const mat = data.matching_settings || {};

      const loadedMonetization = {
        mode: mon.mode || 'free',
        per_minute_rate: mon.per_minute_rate !== undefined ? Number(mon.per_minute_rate) : 1.0,
        currency: mon.currency || 'INR',
        minimum_balance: mon.minimum_balance !== undefined ? Number(mon.minimum_balance) : 5.0,
        free_trial_minutes_new_user: mon.free_trial_minutes_new_user !== undefined ? Number(mon.free_trial_minutes_new_user) : 10,
        free_daily_minute_cap: mon.free_daily_minute_cap !== undefined ? Number(mon.free_daily_minute_cap) : 30,
        subscription_plans: Array.isArray(mon.subscription_plans) && mon.subscription_plans.length > 0 ? mon.subscription_plans : DEFAULT_PLANS,
      };

      const loadedAuth = {
        email_login_enabled: auth.email_login_enabled !== undefined ? Boolean(auth.email_login_enabled) : true,
        mobile_login_enabled: auth.mobile_login_enabled !== undefined ? Boolean(auth.mobile_login_enabled) : false,
        otp_expiry_seconds: auth.otp_expiry_seconds ? Number(auth.otp_expiry_seconds) : 300,
        max_otp_attempts: auth.max_otp_attempts ? Number(auth.max_otp_attempts) : 3,
      };

      const loadedMatching = {
        cooldown_same_peer_seconds: mat.cooldown_same_peer_seconds !== undefined ? Number(mat.cooldown_same_peer_seconds) : 60,
        ring_timeout_seconds: mat.ring_timeout_seconds !== undefined ? Number(mat.ring_timeout_seconds) : 30,
        max_match_attempts: mat.max_match_attempts !== undefined ? Number(mat.max_match_attempts) : 3,
        try_live_presence_first: mat.try_live_presence_first !== undefined ? Boolean(mat.try_live_presence_first) : true,
      };

      setMonetization(loadedMonetization);
      setAuthSettings(loadedAuth);
      setMatchingSettings(loadedMatching);
      setSavedSettings({
        monetization: loadedMonetization,
        auth_settings: loadedAuth,
        matching_settings: loadedMatching,
      });
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load system settings from server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Validation function: ensures non-negative numbers and valid plans
  const validateForm = () => {
    const errors = {};

    if (monetization.mode === 'per_minute') {
      if (monetization.per_minute_rate === '' || Number(monetization.per_minute_rate) < 0 || isNaN(Number(monetization.per_minute_rate))) {
        errors.per_minute_rate = 'Per-minute rate cannot be negative.';
      }
      if (monetization.minimum_balance === '' || Number(monetization.minimum_balance) < 0 || isNaN(Number(monetization.minimum_balance))) {
        errors.minimum_balance = 'Minimum required balance cannot be negative.';
      }
    }

    if (monetization.mode === 'free') {
      if (monetization.free_daily_minute_cap !== '' && Number(monetization.free_daily_minute_cap) < 0) {
        errors.free_daily_minute_cap = 'Daily minute cap cannot be negative.';
      }
      if (monetization.free_trial_minutes_new_user !== '' && Number(monetization.free_trial_minutes_new_user) < 0) {
        errors.free_trial_minutes_new_user = 'Trial minutes cannot be negative.';
      }
    }

    if (monetization.mode === 'subscription') {
      if (!monetization.subscription_plans || monetization.subscription_plans.length === 0) {
        errors.subscription_plans = 'At least one subscription plan is required.';
      } else {
        monetization.subscription_plans.forEach((plan, idx) => {
          if (!plan.name || !plan.name.trim()) {
            errors[`plan_${idx}_name`] = `Plan #${idx + 1} name is required.`;
          }
          if (plan.price === '' || Number(plan.price) < 0 || isNaN(Number(plan.price))) {
            errors[`plan_${idx}_price`] = `Plan #${idx + 1} price cannot be negative.`;
          }
          if (plan.duration_days === '' || Number(plan.duration_days) < 1 || isNaN(Number(plan.duration_days))) {
            errors[`plan_${idx}_duration`] = `Plan #${idx + 1} duration must be at least 1 day.`;
          }
        });
      }
    }

    // Matching settings validation (0 to 86400 seconds integer)
    const cooldownVal = matchingSettings.cooldown_same_peer_seconds;
    if (
      cooldownVal === '' ||
      isNaN(Number(cooldownVal)) ||
      !Number.isInteger(Number(cooldownVal)) ||
      Number(cooldownVal) < 0 ||
      Number(cooldownVal) > 86400
    ) {
      errors.cooldown_same_peer_seconds = 'Cooldown must be an integer between 0 and 86400 seconds.';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Perform actual API persistence
  const executeSave = async () => {
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      // 1. Update monetization settings
      await apiClient.put(API_ENDPOINTS.SETTING_BY_KEY('monetization'), {
        value_json: {
          mode: monetization.mode,
          per_minute_rate: Number(monetization.per_minute_rate) || 1.0,
          currency: monetization.currency || 'INR',
          minimum_balance: Number(monetization.minimum_balance) || 0.0,
          free_trial_minutes_new_user: Number(monetization.free_trial_minutes_new_user) || 0,
          free_daily_minute_cap: monetization.free_daily_minute_cap !== '' ? Number(monetization.free_daily_minute_cap) : null,
          subscription_plans: monetization.subscription_plans,
        },
      });

      // 2. Update auth settings (including mobile login toggle)
      await apiClient.put(API_ENDPOINTS.SETTING_BY_KEY('auth_settings'), {
        value_json: {
          email_login_enabled: authSettings.email_login_enabled,
          mobile_login_enabled: authSettings.mobile_login_enabled,
          otp_expiry_seconds: Number(authSettings.otp_expiry_seconds) || 300,
          max_otp_attempts: Number(authSettings.max_otp_attempts) || 3,
        },
      });

      // 3. Update matching settings (including same-peer rematch cooldown)
      await apiClient.put(API_ENDPOINTS.SETTING_BY_KEY('matching_settings'), {
        value_json: {
          ...matchingSettings,
          cooldown_same_peer_seconds: Number(matchingSettings.cooldown_same_peer_seconds),
        },
      });

      setSavedSettings({
        monetization: { ...monetization },
        auth_settings: { ...authSettings },
        matching_settings: { ...matchingSettings },
      });

      setSuccessMsg('Settings saved successfully! New configurations apply immediately to all active and subsequent calls.');
      setShowConfirmModal(false);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Pre-save check: check validation and determine if mode confirmation is required
  const handleSaveClick = (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!validateForm()) {
      setErrorMsg('Please resolve input validation errors before saving.');
      return;
    }

    // Check if monetization mode was changed from the saved configuration
    const modeChanged = savedSettings && savedSettings.monetization?.mode !== monetization.mode;

    if (modeChanged) {
      // Prompt confirmation dialog before executing
      setShowConfirmModal(true);
    } else {
      executeSave();
    }
  };

  // Subscription plan handlers
  const handleAddPlan = () => {
    const newId = String(Date.now());
    setMonetization((prev) => ({
      ...prev,
      subscription_plans: [
        ...prev.subscription_plans,
        { id: newId, name: 'New Plan', price: 99.0, duration_days: 30, daily_minute_cap: 0 },
      ],
    }));
  };

  const handleUpdatePlan = (index, field, value) => {
    setMonetization((prev) => {
      const updated = [...prev.subscription_plans];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, subscription_plans: updated };
    });
  };

  const handleRemovePlan = (index) => {
    setMonetization((prev) => ({
      ...prev,
      subscription_plans: prev.subscription_plans.filter((_, i) => i !== index),
    }));
  };

  // Strong password policy checks
  const hasMinLength = passwordForm.new_password.length >= 12;
  const hasUpper = /[A-Z]/.test(passwordForm.new_password);
  const hasLower = /[a-z]/.test(passwordForm.new_password);
  const hasDigit = /\d/.test(passwordForm.new_password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(passwordForm.new_password);
  const passwordsMatch = Boolean(passwordForm.new_password && passwordForm.new_password === passwordForm.confirm_password);
  const isStrongPassword = hasMinLength && hasUpper && hasLower && hasDigit && hasSpecial && passwordsMatch;

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!passwordForm.current_password) {
      setPasswordError('Please provide your current admin password.');
      return;
    }

    if (!isStrongPassword) {
      setPasswordError('New password must satisfy all security requirements (min 12 characters, uppercase, lowercase, number, symbol, and matching confirmation).');
      return;
    }

    setPasswordSaving(true);
    try {
      await apiClient.patch(API_ENDPOINTS.CHANGE_PASSWORD, {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      });

      setPasswordSuccess('Admin password updated successfully. The new strong password is now active.');
      setPasswordForm({
        current_password: '',
        new_password: '',
        confirm_password: '',
      });
    } catch (err) {
      setPasswordError(err.message || 'Failed to update admin password.');
    } finally {
      setPasswordSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="state-card state-loading">
          <div className="auth-spinner"></div>
          <h3>Loading Platform Configuration</h3>
          <p>Retrieving active monetization rules and system settings from database...</p>
        </div>
      </div>
    );
  }

  if (errorMsg && !savedSettings) {
    return (
      <div className="page-container">
        <div className="state-card state-error">
          <span className="state-icon">⚠️</span>
          <h3>Unable to Load Settings</h3>
          <p>{errorMsg}</p>
          <button type="button" className="btn-primary" onClick={fetchSettings}>
            🔄 Retry Loading Settings
          </button>
        </div>
      </div>
    );
  }

  const oldModeName = MODES.find((m) => m.id === savedSettings?.monetization?.mode)?.name || 'Previous Mode';
  const newModeName = MODES.find((m) => m.id === monetization.mode)?.name || monetization.mode;

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Configure monetization rules, call billing rates, and authentication providers</p>
      </div>

      {/* Success Notification */}
      {successMsg && (
        <div className="alert-banner alert-success" role="alert">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <div className="alert-content">
            <span className="alert-title">Success</span>
            <span className="alert-text">{successMsg}</span>
          </div>
          <button className="alert-close" onClick={() => setSuccessMsg('')} aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* Error Notification */}
      {errorMsg && (
        <div className="alert-banner alert-danger" role="alert">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div className="alert-content">
            <span className="alert-title">Configuration Error</span>
            <span className="alert-text">{errorMsg}</span>
          </div>
          <button className="alert-close" onClick={() => setErrorMsg('')} aria-label="Dismiss">✕</button>
        </div>
      )}

      <form onSubmit={handleSaveClick}>
        {/* ================================================================= */}
        {/* 1. Monetization Mode Selector */}
        {/* ================================================================= */}
        <section className="settings-section">
          <div className="section-header">
            <h2 className="section-title">Platform Monetization Model</h2>
            <p className="section-desc">Select how anonymous callers are billed. Only parameters relevant to the active model will be used.</p>
          </div>

          <div className="mode-selector-grid">
            {MODES.map((mode) => {
              const isSelected = monetization.mode === mode.id;
              return (
                <div
                  key={mode.id}
                  className={`mode-card ${isSelected ? 'mode-card-selected' : ''}`}
                  onClick={() => setMonetization((prev) => ({ ...prev, mode: mode.id }))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      setMonetization((prev) => ({ ...prev, mode: mode.id }));
                    }
                  }}
                >
                  <div className="mode-card-header">
                    <span className="mode-icon">{mode.icon}</span>
                    <span className={`mode-badge ${isSelected ? 'badge-primary' : 'badge-neutral'}`}>
                      {isSelected ? 'Active Mode' : 'Select'}
                    </span>
                  </div>
                  <h3 className="mode-card-title">{mode.name}</h3>
                  <span className="mode-card-tagline">{mode.tagline}</span>
                  <p className="mode-card-desc">{mode.description}</p>
                </div>
              );
            })}
          </div>

          {/* Conditional Parameter Fields based on Selected Mode */}
          <div className="mode-details-panel">
            {/* ---------------- Mode 1: Free Mode ---------------- */}
            {monetization.mode === 'free' && (
              <div className="mode-fields-group">
                <div className="mode-info-alert">
                  <div className="info-icon">ℹ️</div>
                  <div>
                    <strong>Free Calling Active:</strong> Users do not need wallets, payment methods, or subscriptions. Calls connect freely with optional safety rate limits.
                  </div>
                </div>

                <div className="form-grid-2">
                  <div className="form-group">
                    <label htmlFor="free-trial-mins">
                      Free Trial Minutes for New Users
                      <span className="label-help">Initial credited allowance on registration</span>
                    </label>
                    <input
                      id="free-trial-mins"
                      type="number"
                      min="0"
                      className={`form-input ${validationErrors.free_trial_minutes_new_user ? 'input-error' : ''}`}
                      value={monetization.free_trial_minutes_new_user}
                      onChange={(e) => setMonetization((prev) => ({ ...prev, free_trial_minutes_new_user: e.target.value }))}
                    />
                    {validationErrors.free_trial_minutes_new_user && (
                      <span className="form-error-text">{validationErrors.free_trial_minutes_new_user}</span>
                    )}
                  </div>

                  <div className="form-group">
                    <label htmlFor="free-daily-cap">
                      Free Daily Minute Cap (Per Caller)
                      <span className="label-help">Max daily free minutes allowed (0 or empty = unlimited)</span>
                    </label>
                    <input
                      id="free-daily-cap"
                      type="number"
                      min="0"
                      className={`form-input ${validationErrors.free_daily_minute_cap ? 'input-error' : ''}`}
                      value={monetization.free_daily_minute_cap}
                      onChange={(e) => setMonetization((prev) => ({ ...prev, free_daily_minute_cap: e.target.value }))}
                    />
                    {validationErrors.free_daily_minute_cap && (
                      <span className="form-error-text">{validationErrors.free_daily_minute_cap}</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- Mode 2: Subscription Mode ---------------- */}
            {monetization.mode === 'subscription' && (
              <div className="mode-fields-group">
                <div className="mode-info-alert">
                  <div className="info-icon">💳</div>
                  <div>
                    <strong>Subscription Required:</strong> Callers must subscribe to one of the active plans listed below to place outgoing audio calls. Callees receive calls free.
                  </div>
                </div>

                <div className="plans-editor-header">
                  <div>
                    <h4 className="plans-heading">Available Subscription Plans</h4>
                    <p className="plans-subheading">Configure packages presented to callers for membership purchase</p>
                  </div>
                  <button type="button" className="btn-secondary btn-sm" onClick={handleAddPlan}>
                    + Add Plan
                  </button>
                </div>

                {validationErrors.subscription_plans && (
                  <span className="form-error-text" style={{ marginBottom: '12px', display: 'block' }}>
                    {validationErrors.subscription_plans}
                  </span>
                )}

                <div className="plans-table-container">
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>Plan Name</th>
                        <th>Price (₹ / INR)</th>
                        <th>Duration (Days)</th>
                        <th>Daily Cap (Mins, 0 = No Cap)</th>
                        <th style={{ width: '80px', textAlign: 'center' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monetization.subscription_plans.map((plan, idx) => (
                        <tr key={plan.id || idx}>
                          <td>
                            <input
                              type="text"
                              className={`form-input form-input-sm ${validationErrors[`plan_${idx}_name`] ? 'input-error' : ''}`}
                              value={plan.name}
                              placeholder="e.g. Monthly Unlimited"
                              onChange={(e) => handleUpdatePlan(idx, 'name', e.target.value)}
                            />
                            {validationErrors[`plan_${idx}_name`] && (
                              <span className="form-error-text">{validationErrors[`plan_${idx}_name`]}</span>
                            )}
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className={`form-input form-input-sm ${validationErrors[`plan_${idx}_price`] ? 'input-error' : ''}`}
                              value={plan.price}
                              placeholder="0.00"
                              onChange={(e) => handleUpdatePlan(idx, 'price', e.target.value)}
                            />
                            {validationErrors[`plan_${idx}_price`] && (
                              <span className="form-error-text">{validationErrors[`plan_${idx}_price`]}</span>
                            )}
                          </td>
                          <td>
                            <input
                              type="number"
                              min="1"
                              className={`form-input form-input-sm ${validationErrors[`plan_${idx}_duration`] ? 'input-error' : ''}`}
                              value={plan.duration_days}
                              placeholder="30"
                              onChange={(e) => handleUpdatePlan(idx, 'duration_days', e.target.value)}
                            />
                            {validationErrors[`plan_${idx}_duration`] && (
                              <span className="form-error-text">{validationErrors[`plan_${idx}_duration`]}</span>
                            )}
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              className="form-input form-input-sm"
                              value={plan.daily_minute_cap || 0}
                              placeholder="0"
                              onChange={(e) => handleUpdatePlan(idx, 'daily_minute_cap', e.target.value)}
                            />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn-danger-icon"
                              title="Delete Plan"
                              onClick={() => handleRemovePlan(idx)}
                              disabled={monetization.subscription_plans.length <= 1}
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ---------------- Mode 3: Per-Minute Mode ---------------- */}
            {monetization.mode === 'per_minute' && (
              <div className="mode-fields-group">
                <div className="mode-info-alert">
                  <div className="info-icon">⏱️</div>
                  <div>
                    <strong>Per-Minute Billing Active:</strong> Callers are debited every 60 seconds from their prepaid wallet balance. If balance exhausts, the call terminates automatically.
                  </div>
                </div>

                <div className="form-grid-3">
                  <div className="form-group">
                    <label htmlFor="per-minute-rate">
                      Per-Minute Rate (₹ / min)
                      <span className="label-help">Amount debited each active call minute</span>
                    </label>
                    <div className="input-prefix-wrapper">
                      <span className="input-prefix">₹</span>
                      <input
                        id="per-minute-rate"
                        type="number"
                        min="0"
                        step="0.10"
                        className={`form-input ${validationErrors.per_minute_rate ? 'input-error' : ''}`}
                        value={monetization.per_minute_rate}
                        onChange={(e) => setMonetization((prev) => ({ ...prev, per_minute_rate: e.target.value }))}
                      />
                    </div>
                    {validationErrors.per_minute_rate && (
                      <span className="form-error-text">{validationErrors.per_minute_rate}</span>
                    )}
                  </div>

                  <div className="form-group">
                    <label htmlFor="min-balance">
                      Minimum Balance Required
                      <span className="label-help">Minimum wallet amount to start a call</span>
                    </label>
                    <div className="input-prefix-wrapper">
                      <span className="input-prefix">₹</span>
                      <input
                        id="min-balance"
                        type="number"
                        min="0"
                        step="0.50"
                        className={`form-input ${validationErrors.minimum_balance ? 'input-error' : ''}`}
                        value={monetization.minimum_balance}
                        onChange={(e) => setMonetization((prev) => ({ ...prev, minimum_balance: e.target.value }))}
                      />
                    </div>
                    {validationErrors.minimum_balance && (
                      <span className="form-error-text">{validationErrors.minimum_balance}</span>
                    )}
                  </div>

                  <div className="form-group">
                    <label htmlFor="currency-code">
                      Currency Code
                      <span className="label-help">ISO-4217 Currency symbol</span>
                    </label>
                    <input
                      id="currency-code"
                      type="text"
                      className="form-input"
                      value={monetization.currency}
                      onChange={(e) => setMonetization((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))}
                      maxLength={3}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ================================================================= */}
        {/* 2. Authentication & Mobile Login Toggle */}
        {/* ================================================================= */}
        <section className="settings-section">
          <div className="section-header">
            <h2 className="section-title">Authentication & Login Controls</h2>
            <p className="section-desc">Manage permitted registration and sign-in channels for mobile clients.</p>
          </div>

          <div className="settings-card">
            {/* Mobile Login Toggle with SMS Cost Warning */}
            <div className="toggle-row">
              <div className="toggle-info">
                <div className="toggle-title-line">
                  <span className="toggle-title">Allow Mobile Phone OTP Login</span>
                  <span className={`status-pill ${authSettings.mobile_login_enabled ? 'pill-warning' : 'pill-neutral'}`}>
                    {authSettings.mobile_login_enabled ? 'Enabled' : 'Disabled (Default MVP)'}
                  </span>
                </div>
                <p className="toggle-desc">
                  When enabled, mobile users can request a one-time SMS verification code to register or authenticate.
                </p>

                {/* Prominent SMS Cost Warning */}
                <div className="sms-cost-warning-box">
                  <div className="warning-icon">⚠️</div>
                  <div className="warning-text">
                    <strong>Direct SMS Gateway Cost Notice:</strong>
                    <p>
                      Every SMS OTP sent incurs a monetary cost from your telephony carrier or SMS API provider (e.g., Twilio, AWS SNS, Fast2SMS).
                      Keep this setting <strong>disabled</strong> during test and development phases to avoid unintended balance drain.
                    </p>
                  </div>
                </div>
              </div>

              <div className="toggle-switch-wrapper">
                <label className="switch">
                  <input
                    type="checkbox"
                    id="mobile-login-toggle"
                    checked={authSettings.mobile_login_enabled}
                    onChange={(e) => setAuthSettings((prev) => ({ ...prev, mobile_login_enabled: e.target.checked }))}
                  />
                  <span className="slider round"></span>
                </label>
              </div>
            </div>

            {/* Email / Password Status (Standard) */}
            <div className="toggle-row border-top">
              <div className="toggle-info">
                <div className="toggle-title-line">
                  <span className="toggle-title">Email & Password Authentication</span>
                  <span className="status-pill pill-success">Always Enabled</span>
                </div>
                <p className="toggle-desc">
                  Primary anonymous auth method. Fast, zero-cost, and secure with bcrypt and JWT rotation.
                </p>
              </div>
              <div className="toggle-switch-wrapper">
                <label className="switch switch-disabled">
                  <input type="checkbox" checked={true} disabled />
                  <span className="slider round"></span>
                </label>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================= */}
        {/* 3. Matching Section */}
        {/* ================================================================= */}
        <section className="settings-section">
          <div className="section-header">
            <h2 className="section-title">Matching</h2>
            <p className="section-desc">Configure peer matching rules, rematch cooldowns, and pairing thresholds.</p>
          </div>

          <div className="settings-card">
            <div className="form-group" style={{ maxWidth: '540px' }}>
              <label htmlFor="cooldown-same-peer">
                Don't re-match the same two users for N seconds
                <span className="label-help">
                  0 = allow immediate rematch. Higher values reduce repeat matches but can cause 'no users available' when few users are online.
                </span>
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
                <input
                  id="cooldown-same-peer"
                  type="number"
                  min="0"
                  max="86400"
                  step="1"
                  className={`form-input ${validationErrors.cooldown_same_peer_seconds ? 'input-error' : ''}`}
                  value={matchingSettings.cooldown_same_peer_seconds}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMatchingSettings((prev) => ({ ...prev, cooldown_same_peer_seconds: val }));
                    if (validationErrors.cooldown_same_peer_seconds) {
                      setValidationErrors((prev) => {
                        const updated = { ...prev };
                        delete updated.cooldown_same_peer_seconds;
                        return updated;
                      });
                    }
                  }}
                  style={{ width: '160px' }}
                />
                <span style={{ color: '#94a3b8', fontSize: '14px' }}>seconds</span>

                {savedSettings?.matching_settings?.cooldown_same_peer_seconds !== undefined && (
                  <span style={{ color: '#64748b', fontSize: '13px', marginLeft: 'auto' }}>
                    Saved value: <strong>{savedSettings.matching_settings.cooldown_same_peer_seconds}s</strong>
                  </span>
                )}
              </div>

              {validationErrors.cooldown_same_peer_seconds && (
                <span className="form-error-text" style={{ marginTop: '6px', display: 'block' }}>
                  {validationErrors.cooldown_same_peer_seconds}
                </span>
              )}

              {/* Quick preset buttons: 0, 30s, 60s, 5 min, 30 min */}
              <div style={{ marginTop: '14px' }}>
                <span style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '8px' }}>
                  Quick Presets:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {[
                    { label: '0 (Allow immediate rematch)', value: 0 },
                    { label: '30s', value: 30 },
                    { label: '60s', value: 60 },
                    { label: '5 min', value: 300 },
                    { label: '30 min', value: 1800 },
                  ].map((preset) => {
                    const isSelected = Number(matchingSettings.cooldown_same_peer_seconds) === preset.value && matchingSettings.cooldown_same_peer_seconds !== '';
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => {
                          setMatchingSettings((prev) => ({ ...prev, cooldown_same_peer_seconds: preset.value }));
                          setValidationErrors((prev) => {
                            const updated = { ...prev };
                            delete updated.cooldown_same_peer_seconds;
                            return updated;
                          });
                        }}
                        style={{
                          padding: '6px 12px',
                          fontSize: '12px',
                          fontWeight: '600',
                          borderRadius: '6px',
                          border: isSelected ? '1px solid #3b82f6' : '1px solid #334155',
                          background: isSelected ? '#1d4ed8' : '#1e293b',
                          color: isSelected ? '#ffffff' : '#cbd5e1',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Save & Action Footer Bar */}
        <div className="settings-action-bar">
          <div className="action-summary">
            {savedSettings && savedSettings.monetization?.mode !== monetization.mode && (
              <span className="mode-change-badge">
                ⚠️ Mode change pending: <strong>{oldModeName}</strong> ➔ <strong>{newModeName}</strong>
              </span>
            )}
          </div>

          <div className="action-buttons">
            <button
              type="button"
              className="btn-secondary"
              onClick={fetchSettings}
              disabled={saving}
            >
              Discard Changes
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving}
              id="save-settings-btn"
            >
              {saving ? 'Saving Changes...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </form>

      {/* ================================================================= */}
      {/* 3. Administrator Security & Strong Password Policy */}
      {/* ================================================================= */}
      <section className="settings-section" style={{ marginTop: '32px' }}>
        <div className="section-header">
          <h2 className="section-title">Administrator Security & Password Policy</h2>
          <p className="section-desc">
            Enforces strict password hygiene. Admin credentials require minimum 12 characters, uppercase, lowercase, numbers, and symbols.
          </p>
        </div>

        {passwordSuccess && (
          <div className="alert-banner alert-success" role="alert" style={{ marginBottom: '16px' }}>
            <div className="alert-content">
              <span className="alert-title">Password Updated</span>
              <span className="alert-text">{passwordSuccess}</span>
            </div>
            <button className="alert-close" onClick={() => setPasswordSuccess('')} aria-label="Dismiss">✕</button>
          </div>
        )}

        {passwordError && (
          <div className="alert-banner alert-danger" role="alert" style={{ marginBottom: '16px' }}>
            <div className="alert-content">
              <span className="alert-title">Password Policy Error</span>
              <span className="alert-text">{passwordError}</span>
            </div>
            <button className="alert-close" onClick={() => setPasswordError('')} aria-label="Dismiss">✕</button>
          </div>
        )}

        <div className="settings-card">
          <form onSubmit={handleChangePassword}>
            <div className="form-grid-2">
              <div className="form-group">
                <label htmlFor="current-admin-pass">Current Password</label>
                <input
                  id="current-admin-pass"
                  type="password"
                  className="form-input"
                  placeholder="Enter current password"
                  value={passwordForm.current_password}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, current_password: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="form-grid-2" style={{ marginTop: '12px' }}>
              <div className="form-group">
                <label htmlFor="new-admin-pass">New Admin Password</label>
                <input
                  id="new-admin-pass"
                  type="password"
                  className="form-input"
                  placeholder="At least 12 characters"
                  value={passwordForm.new_password}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, new_password: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirm-admin-pass">Confirm New Password</label>
                <input
                  id="confirm-admin-pass"
                  type="password"
                  className="form-input"
                  placeholder="Re-type new password"
                  value={passwordForm.confirm_password}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm_password: e.target.value }))}
                  required
                />
              </div>
            </div>

            {/* Live Password Policy Checklist */}
            <div style={{ marginTop: '14px', padding: '12px', background: '#0f172a', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', display: 'block', marginBottom: '8px' }}>
                Strong Password Requirements:
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '6px', fontSize: '12px' }}>
                <span style={{ color: hasMinLength ? '#22c55e' : '#64748b' }}>
                  {hasMinLength ? '✓' : '○'} At least 12 characters
                </span>
                <span style={{ color: hasUpper ? '#22c55e' : '#64748b' }}>
                  {hasUpper ? '✓' : '○'} One uppercase letter (A-Z)
                </span>
                <span style={{ color: hasLower ? '#22c55e' : '#64748b' }}>
                  {hasLower ? '✓' : '○'} One lowercase letter (a-z)
                </span>
                <span style={{ color: hasDigit ? '#22c55e' : '#64748b' }}>
                  {hasDigit ? '✓' : '○'} One number (0-9)
                </span>
                <span style={{ color: hasSpecial ? '#22c55e' : '#64748b' }}>
                  {hasSpecial ? '✓' : '○'} One symbol (!@#$%^&*)
                </span>
                <span style={{ color: passwordsMatch ? '#22c55e' : '#64748b' }}>
                  {passwordsMatch ? '✓' : '○'} Passwords match
                </span>
              </div>
            </div>

            <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="btn-primary"
                disabled={passwordSaving || !isStrongPassword}
              >
                {passwordSaving ? 'Updating Password...' : 'Update Admin Password'}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* ================================================================= */}
      {/* 4. Confirmation Modal for Monetization Mode Change */}
      {/* ================================================================= */}
      {showConfirmModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-icon-warning">⚠️</div>
              <h3 id="modal-title" className="modal-title">Confirm Monetization Mode Change</h3>
            </div>

            <div className="modal-body">
              <p>
                You are about to change the platform monetization model from{' '}
                <span className="mode-highlight">{oldModeName}</span> to{' '}
                <span className="mode-highlight">{newModeName}</span>.
              </p>
              <div className="modal-callout">
                <strong>Important:</strong> This change updates the database instantly. All newly initiated calls and active callers will immediately be evaluated under <strong>{newModeName}</strong> rules.
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowConfirmModal(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger-primary"
                onClick={executeSave}
                disabled={saving}
              >
                {saving ? 'Applying Change...' : 'Confirm & Apply Mode Change'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsPage;
