import React from 'react';

export function ReportsPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">Abuse reports queue, user moderation, and ban actions</p>
      </div>

      <div className="placeholder-card">
        <div className="placeholder-icon">⚠️</div>
        <h3>Abuse Reports (Placeholder)</h3>
        <p>Incoming user abuse reports, review actions, and moderation decisions will be processed here.</p>
      </div>
    </div>
  );
}

export default ReportsPage;
