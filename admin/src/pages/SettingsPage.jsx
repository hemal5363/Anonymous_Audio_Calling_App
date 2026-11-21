import React from 'react';

export function SettingsPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Configure monetization mode, login methods, and call parameters</p>
      </div>

      <div className="placeholder-card">
        <div className="placeholder-icon">⚙️</div>
        <h3>System Settings (Placeholder)</h3>
        <p>Monetization mode (free, subscription, per-minute), rates, and mobile OTP toggles will be configured here.</p>
      </div>
    </div>
  );
}

export default SettingsPage;
