import React, { useState } from 'react';
import { apiClient } from '../api/client.js';
import { API_ENDPOINTS } from '../api/endpoints.js';

export function ChangePasswordModal({ isOpen, onClose }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  // Real-time password policy validation checks (minimum 12 characters)
  const hasMinLength = newPassword.length >= 12;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasDigit = /\d/.test(newPassword);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(newPassword);
  const passwordsMatch = Boolean(newPassword && newPassword === confirmPassword);
  const isPolicyMet = hasMinLength && hasUpper && hasLower && hasDigit && hasSpecial && passwordsMatch;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!currentPassword) {
      setErrorMsg('Current password is required.');
      return;
    }

    if (!isPolicyMet) {
      setErrorMsg('New password must satisfy all policy requirements (minimum 12 characters, uppercase, lowercase, number, symbol, and matching confirmation).');
      return;
    }

    setSaving(true);
    try {
      await apiClient.patch(API_ENDPOINTS.CHANGE_PASSWORD, {
        current_password: currentPassword,
        new_password: newPassword,
      });

      setSuccessMsg('Admin password updated successfully! All existing refresh tokens have been revoked.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update administrator password.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setErrorMsg('');
    setSuccessMsg('');
    onClose();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="change-password-modal-title">
      <div className="modal-card" style={{ maxWidth: '540px' }}>
        <div className="modal-header">
          <div className="modal-icon-warning">🔑</div>
          <h3 id="change-password-modal-title" className="modal-title">Change Administrator Password</h3>
        </div>

        <div className="modal-body">
          <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '14px' }}>
            Updating your password enforces the platform security policy and automatically revokes all existing admin refresh tokens.
          </p>

          {successMsg && (
            <div className="alert-banner alert-success" role="alert" style={{ marginBottom: '14px' }}>
              <div className="alert-content">
                <span className="alert-title">Success</span>
                <span className="alert-text">{successMsg}</span>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="alert-banner alert-danger" role="alert" style={{ marginBottom: '14px' }}>
              <div className="alert-content">
                <span className="alert-title">Error</span>
                <span className="alert-text">{errorMsg}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} id="admin-change-password-form">
            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label htmlFor="modal-current-password">Current Password</label>
              <input
                id="modal-current-password"
                type="password"
                className="form-input"
                placeholder="Enter your current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={saving}
                required
                autoComplete="current-password"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label htmlFor="modal-new-password">New Password (min 12 characters)</label>
              <input
                id="modal-new-password"
                type="password"
                className="form-input"
                placeholder="At least 12 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={saving}
                required
                autoComplete="new-password"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label htmlFor="modal-confirm-password">Confirm New Password</label>
              <input
                id="modal-confirm-password"
                type="password"
                className="form-input"
                placeholder="Re-type new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={saving}
                required
                autoComplete="new-password"
              />
            </div>

            {/* Live Password Policy Checklist */}
            <div style={{ padding: '12px', background: '#0f172a', borderRadius: '8px', border: '1px solid #1e293b', marginBottom: '16px' }}>
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
                Password Policy Requirements:
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '12px' }}>
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
          </form>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleClose}
            disabled={saving}
          >
            {successMsg ? 'Done' : 'Cancel'}
          </button>
          {!successMsg && (
            <button
              type="submit"
              form="admin-change-password-form"
              className="btn-primary"
              disabled={saving || !isPolicyMet}
            >
              {saving ? 'Updating...' : 'Update Password'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChangePasswordModal;
