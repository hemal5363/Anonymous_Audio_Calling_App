import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client.js';
import { API_ENDPOINTS } from '../api/endpoints.js';

export function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 1 });
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Confirmation modal for Ban Action
  const [banModalReport, setBanModalReport] = useState(null);
  const [banNote, setBanNote] = useState('Banned due to validated abuse report');

  const fetchReports = useCallback(async (page = 1, status = statusFilter) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '15',
      });
      if (status) params.append('status', status);

      const data = await apiClient.get(`${API_ENDPOINTS.REPORTS}?${params.toString()}`);
      setReports(data.reports || []);
      setPagination(data.pagination || { page: 1, limit: 15, total: 0, totalPages: 1 });
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load abuse reports.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchReports(1);
  }, [statusFilter]);

  const handleResolve = async (reportId, newStatus, actionTaken, note) => {
    setActionLoadingId(reportId);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await apiClient.patch(API_ENDPOINTS.REPORT_ACTION(reportId), {
        status: newStatus,
        action_taken: actionTaken,
        note: note || undefined,
      });

      setSuccessMsg(`Report marked as "${newStatus}" with action "${actionTaken}".`);
      setBanModalReport(null);
      fetchReports(pagination.page);
    } catch (err) {
      setErrorMsg(err.message || `Failed to update report.`);
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">Abuse reports queue, user behavior audits, and safety enforcement</p>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="alert-banner alert-success" role="alert">
          <div className="alert-content">
            <span className="alert-title">Success</span>
            <span className="alert-text">{successMsg}</span>
          </div>
          <button className="alert-close" onClick={() => setSuccessMsg('')}>✕</button>
        </div>
      )}

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
          <label htmlFor="report-status-filter" className="filter-label">Status Queue:</label>
          <select
            id="report-status-filter"
            className="form-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="pending">Pending Review (Urgent)</option>
            <option value="reviewed">Reviewed</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
            <option value="">All Reports</option>
          </select>
        </div>
      </div>

      {/* Reports Table */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Report ID</th>
              <th>Date / Time</th>
              <th>Call Session</th>
              <th>Report Reason</th>
              <th>User Note / Details</th>
              <th>Status</th>
              <th>Action Taken</th>
              <th style={{ textAlign: 'center' }}>Moderation Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" className="table-empty-cell">
                  <div className="auth-spinner" style={{ margin: '20px auto' }}></div>
                  <p>Loading reports...</p>
                </td>
              </tr>
            ) : reports.length === 0 ? (
              <tr>
                <td colSpan="8" className="table-empty-cell">
                  <span className="empty-icon">🛡️</span>
                  <p>No abuse reports found in this queue.</p>
                </td>
              </tr>
            ) : (
              reports.map((r) => {
                const isBusy = actionLoadingId === r.id;

                return (
                  <tr key={r.id}>
                    <td>
                      <code className="uuid-tag" title={r.id}>
                        {r.id.substring(0, 8)}...
                      </code>
                    </td>
                    <td>
                      <span className="timestamp-text">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                    </td>
                    <td>
                      <code className="uuid-tag" title={r.call_code}>
                        {r.call_code ? `${r.call_code.substring(0, 8)}...` : 'N/A'}
                      </code>
                    </td>
                    <td>
                      <span className="report-reason-badge">
                        {r.reason ? r.reason.replace('_', ' ') : 'General'}
                      </span>
                    </td>
                    <td>
                      <span className="report-note" title={r.note || 'No notes provided'}>
                        {r.note || <em className="text-muted">No note</em>}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill pill-${r.status}`}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      <span className={`action-pill action-${r.action_taken || 'none'}`}>
                        {r.action_taken || 'none'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="table-actions">
                        {r.status === 'pending' && (
                          <button
                            type="button"
                            className="btn-action-review"
                            onClick={() => handleResolve(r.id, 'reviewed', 'none', 'Marked reviewed by admin')}
                            disabled={isBusy}
                          >
                            Mark Reviewed
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-action-ban"
                          onClick={() => {
                            setBanModalReport(r);
                            setBanNote(`Banned user following review of report ${r.id}`);
                          }}
                          disabled={isBusy || r.action_taken === 'ban'}
                        >
                          {r.action_taken === 'ban' ? 'Banned' : 'Ban User'}
                        </button>
                        {r.status !== 'dismissed' && (
                          <button
                            type="button"
                            className="btn-action-dismiss"
                            onClick={() => handleResolve(r.id, 'dismissed', 'none', 'Dismissed by admin')}
                            disabled={isBusy}
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="pagination-bar">
        <span className="pagination-info">
          Showing Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages || 1}</strong> ({pagination.total} reports)
        </span>
        <div className="pagination-buttons">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={pagination.page <= 1 || loading}
            onClick={() => fetchReports(pagination.page - 1)}
          >
            ← Previous
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={pagination.page >= pagination.totalPages || loading}
            onClick={() => fetchReports(pagination.page + 1)}
          >
            Next →
          </button>
        </div>
      </div>

      {/* Ban User Confirmation Modal */}
      {banModalReport && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-icon-warning">🚫</div>
              <h3 className="modal-title">Ban Reported User</h3>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to ban the reported peer for report <code>{banModalReport.id.substring(0, 8)}</code>?
              </p>
              <div className="form-group" style={{ marginTop: '10px' }}>
                <label htmlFor="report-ban-note">Resolution Note:</label>
                <input
                  id="report-ban-note"
                  type="text"
                  className="form-input"
                  value={banNote}
                  onChange={(e) => setBanNote(e.target.value)}
                />
              </div>
              <div className="modal-callout">
                This action will mark the report <strong>resolved</strong> with action <strong>ban</strong> and permanently ban the reported user account.
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setBanModalReport(null)}
                disabled={Boolean(actionLoadingId)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger-primary"
                onClick={() => handleResolve(banModalReport.id, 'resolved', 'ban', banNote)}
                disabled={Boolean(actionLoadingId)}
              >
                {actionLoadingId ? 'Applying Ban...' : 'Confirm & Ban Reported User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReportsPage;
