import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client.js';
import { API_ENDPOINTS } from '../api/endpoints.js';

export function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const data = await apiClient.get(API_ENDPOINTS.STATS);
      setStats(data);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load platform dashboard statistics.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchStats();
  };

  const formatDuration = (seconds) => {
    if (!seconds || seconds <= 0) return '0s';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  if (loading && !stats) {
    return (
      <div className="page-container">
        <div className="auth-loading-screen" style={{ height: '350px' }}>
          <div className="auth-spinner"></div>
          <p>Loading real-time platform metrics...</p>
        </div>
      </div>
    );
  }

  const overview = stats?.overview || {};
  const todayMetrics = stats?.today_metrics || {};
  const safety = stats?.safety_metrics || {};
  const isPaidMode = todayMetrics.monetization_mode === 'per_minute' || todayMetrics.monetization_mode === 'subscription';

  return (
    <div className="page-container">
      {/* Top Header with Refresh Action */}
      <div className="dashboard-top-bar">
        <div className="page-header">
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Real-time vitals, call traffic, safety moderation, and revenue metrics</p>
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh metrics"
        >
          {refreshing ? 'Refreshing...' : '🔄 Refresh Metrics'}
        </button>
      </div>

      {errorMsg && (
        <div className="alert-banner alert-danger" role="alert">
          <div className="alert-content">
            <span className="alert-title">Error</span>
            <span className="alert-text">{errorMsg}</span>
          </div>
          <button className="alert-close" onClick={() => setErrorMsg('')}>✕</button>
        </div>
      )}

      {/* Safety Alert Callout if pending reports exist */}
      {safety.pending_reports_count > 0 && (
        <div className="alert-banner alert-warning" role="alert">
          <div className="alert-content">
            <span className="alert-title">⚠️ Moderation Attention Needed</span>
            <span className="alert-text">
              There are <strong>{safety.pending_reports_count}</strong> pending abuse report(s) requiring review.
            </span>
          </div>
          <Link to="/reports" className="btn-primary btn-sm">
            Review Reports →
          </Link>
        </div>
      )}

      {/* Primary KPI Metrics Grid */}
      <div className="stats-kpi-grid">
        {/* 1. Total Registered Users */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Total Users</span>
            <span className="kpi-icon">👥</span>
          </div>
          <div className="kpi-value">{overview.total_registered_users ?? 0}</div>
          <span className="kpi-subtext">Registered user accounts</span>
        </div>

        {/* 2. Users Available Now */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Users Available Now</span>
            <span className="kpi-icon">🟢</span>
          </div>
          <div className="kpi-value kpi-highlight-green">
            {overview.currently_available_users ?? 0}
          </div>
          <span className="kpi-subtext">
            Online & available for calls ({overview.currently_online_sockets ?? 0} online sockets)
          </span>
        </div>

        {/* 3. Calls Today */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Calls Today</span>
            <span className="kpi-icon">📞</span>
          </div>
          <div className="kpi-value">{todayMetrics.total_calls_initiated ?? 0}</div>
          <span className="kpi-subtext">
            <strong>{todayMetrics.total_connected_calls ?? 0}</strong> connected ({todayMetrics.total_call_minutes ?? 0} total mins)
          </span>
        </div>

        {/* 4. Average Call Duration */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Avg Call Duration</span>
            <span className="kpi-icon">⏱️</span>
          </div>
          <div className="kpi-value">
            {formatDuration(todayMetrics.average_call_duration_seconds)}
          </div>
          <span className="kpi-subtext">Across connected calls today</span>
        </div>

        {/* 5. Revenue (if paid mode) */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Today's Revenue</span>
            <span className="kpi-icon">💰</span>
          </div>
          {isPaidMode ? (
            <>
              <div className="kpi-value kpi-highlight-primary">
                ₹{Number(todayMetrics.total_revenue || 0).toFixed(2)}
              </div>
              <span className="kpi-subtext">
                Paid mode active ({todayMetrics.monetization_mode})
              </span>
            </>
          ) : (
            <>
              <div className="kpi-value text-muted">₹0.00</div>
              <span className="kpi-subtext pill-free-badge">
                Free Mode Active (Zero Caller Fees)
              </span>
            </>
          )}
        </div>
      </div>

      {/* Secondary Dashboard Sections: Live Status & Safety Overview */}
      <div className="dashboard-grid-2">
        {/* Platform Vitals */}
        <div className="dashboard-panel">
          <div className="panel-header">
            <h3 className="panel-title">Real-Time Platform Vitals</h3>
            <span className="live-indicator">
              <span className="dot dot-green"></span> Live
            </span>
          </div>
          <div className="vitals-list">
            <div className="vital-item">
              <span className="vital-label">Active Calls Right Now:</span>
              <span className="vital-val-pill">{overview.active_calls_now ?? 0}</span>
            </div>
            <div className="vital-item">
              <span className="vital-label">Live Online Sockets:</span>
              <span className="vital-val-pill">{overview.currently_online_sockets ?? 0}</span>
            </div>
            <div className="vital-item">
              <span className="vital-label">Available Call Candidates:</span>
              <span className="vital-val-pill">{overview.currently_available_users ?? 0}</span>
            </div>
            <div className="vital-item">
              <span className="vital-label">Active Monetization Model:</span>
              <Link to="/settings" className="vital-link">
                {todayMetrics.monetization_mode ? todayMetrics.monetization_mode.toUpperCase() : 'FREE'} ⚙️
              </Link>
            </div>
          </div>
        </div>

        {/* Safety & Moderation Summary */}
        <div className="dashboard-panel">
          <div className="panel-header">
            <h3 className="panel-title">Safety & Moderation Status</h3>
            <Link to="/reports" className="panel-action-link">
              View Queue →
            </Link>
          </div>
          <div className="vitals-list">
            <div className="vital-item">
              <span className="vital-label">Pending Abuse Reports:</span>
              <span className={`vital-val-pill ${safety.pending_reports_count > 0 ? 'pill-warning' : ''}`}>
                {safety.pending_reports_count ?? 0}
              </span>
            </div>
            <div className="vital-item">
              <span className="vital-label">Banned Users:</span>
              <span className="vital-val-pill">{safety.banned_users_count ?? 0}</span>
            </div>
            <div className="vital-item">
              <span className="vital-label">Call History Records:</span>
              <Link to="/call-logs" className="vital-link">
                Inspect Call Logs →
              </Link>
            </div>
            <div className="vital-item">
              <span className="vital-label">User Accounts Directory:</span>
              <Link to="/users" className="vital-link">
                Manage Users →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
