import React from 'react';

export function DashboardPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Platform health, live vitals, and daily calling metrics</p>
      </div>

      <div className="placeholder-card">
        <div className="placeholder-icon">📊</div>
        <h3>Dashboard Metrics (Placeholder)</h3>
        <p>Live active callers, online sockets, and daily talk minute statistics will be displayed here.</p>
      </div>
    </div>
  );
}

export default DashboardPage;
