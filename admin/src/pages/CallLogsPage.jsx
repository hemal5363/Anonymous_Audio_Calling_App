import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client.js';
import { API_ENDPOINTS } from '../api/endpoints.js';

export function CallLogsPage() {
  const [calls, setCalls] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 1 });
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const fetchCalls = useCallback(async (page = 1, status = statusFilter) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '15',
      });
      if (status) params.append('status', status);

      const data = await apiClient.get(`${API_ENDPOINTS.CALL_LOGS}?${params.toString()}`);
      setCalls(data.calls || []);
      setPagination(data.pagination || { page: 1, limit: 15, total: 0, totalPages: 1 });
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load call session logs.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchCalls(1);
  }, [statusFilter]);

  const formatDuration = (seconds) => {
    if (!seconds || seconds <= 0) return '0s';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Call Logs</h1>
        <p className="page-subtitle">Historical call session records, timestamps, durations, and termination reasons</p>
      </div>

      {/* Strict Privacy & Anonymity Callout */}
      <div className="privacy-callout-banner">
        <div className="privacy-icon">🔒</div>
        <div className="privacy-text">
          <strong>Strict End-to-End Anonymity:</strong>
          <p>
            Calls are connected peer-to-peer via encrypted WebRTC. 
            <strong> No call audio is ever recorded or stored on any server, and no audio files exist.</strong> 
            Only anonymous session codes and operational metadata are retained for billing and connection diagnostics.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {errorMsg && (
        <div className="alert-banner alert-danger" role="alert">
          <div className="alert-content">
            <span className="alert-title">Error</span>
            <span className="alert-text">{errorMsg}</span>
          </div>
          <button className="alert-close" onClick={() => setErrorMsg('')}>✕</button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="filters-bar">
        <div className="filter-dropdown-group">
          <label htmlFor="call-status-filter" className="filter-label">Filter by Status:</label>
          <select
            id="call-status-filter"
            className="form-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Call Sessions</option>
            <option value="connected">Connected / Active</option>
            <option value="ended">Ended Successfully</option>
            <option value="declined">Declined</option>
            <option value="missed">Missed (Ring Timeout)</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* Call Logs Table */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date / Time</th>
              <th>Anonymous Session ID</th>
              <th>Call Code</th>
              <th>Status</th>
              <th>Duration</th>
              <th>End Reason</th>
              <th>Billing Mode</th>
              <th>Amount Charged</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" className="table-empty-cell">
                  <div className="auth-spinner" style={{ margin: '20px auto' }}></div>
                  <p>Loading call logs...</p>
                </td>
              </tr>
            ) : calls.length === 0 ? (
              <tr>
                <td colSpan="8" className="table-empty-cell">
                  <span className="empty-icon">📞</span>
                  <p>No call sessions match the selected filter.</p>
                </td>
              </tr>
            ) : (
              calls.map((call) => (
                <tr key={call.session_id}>
                  <td>
                    <span className="timestamp-text">
                      {new Date(call.created_at).toLocaleString()}
                    </span>
                  </td>
                  <td>
                    <code className="uuid-tag" title={call.session_id}>
                      {call.session_id.substring(0, 8)}...
                    </code>
                  </td>
                  <td>
                    <code className="uuid-tag" title={call.call_code}>
                      {call.call_code.substring(0, 8)}...
                    </code>
                  </td>
                  <td>
                    <span className={`status-pill pill-${call.status}`}>
                      {call.status}
                    </span>
                  </td>
                  <td>
                    <span className="duration-tag">
                      {formatDuration(call.duration_seconds)}
                    </span>
                  </td>
                  <td>
                    <span className="end-reason-badge">
                      {call.end_reason ? call.end_reason.replace('_', ' ') : 'active / none'}
                    </span>
                  </td>
                  <td>
                    <span className="mode-pill">
                      {call.billing_mode || 'free'}
                    </span>
                  </td>
                  <td>
                    <span className="wallet-amount">
                      ₹{Number(call.amount_charged || 0).toFixed(2)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="pagination-bar">
        <span className="pagination-info">
          Showing Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages || 1}</strong> ({pagination.total} total sessions)
        </span>
        <div className="pagination-buttons">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={pagination.page <= 1 || loading}
            onClick={() => fetchCalls(pagination.page - 1)}
          >
            ← Previous
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={pagination.page >= pagination.totalPages || loading}
            onClick={() => fetchCalls(pagination.page + 1)}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

export default CallLogsPage;
