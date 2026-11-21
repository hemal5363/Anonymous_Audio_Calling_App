import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client.js';
import { API_ENDPOINTS } from '../api/endpoints.js';

export function UsersPage() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Confirmation modal state for Ban action
  const [banModalUser, setBanModalUser] = useState(null);
  const [banReason, setBanReason] = useState('Violation of platform safety policies');

  const fetchUsers = useCallback(async (page = 1, searchQuery = search, status = statusFilter) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '15',
      });
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (status) params.append('status', status);

      const data = await apiClient.get(`${API_ENDPOINTS.USERS}?${params.toString()}`);
      setUsers(data.users || []);
      setPagination(data.pagination || { page: 1, limit: 15, total: 0, totalPages: 1 });
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load user directory.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchUsers(1);
  }, [statusFilter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchUsers(1, search, statusFilter);
  };

  const handleStatusChange = async (userId, newStatus, reason = '') => {
    setActionLoadingId(userId);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await apiClient.patch(API_ENDPOINTS.USER_STATUS(userId), {
        status: newStatus,
        reason: reason || undefined,
      });

      setSuccessMsg(`User status updated to "${newStatus}" successfully.`);
      setBanModalUser(null);
      // Refresh list
      fetchUsers(pagination.page);
    } catch (err) {
      setErrorMsg(err.message || `Failed to update status to ${newStatus}.`);
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Users</h1>
        <p className="page-subtitle">Search registered user accounts, manage suspension status, and monitor live availability</p>
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

      {/* Filter & Search Bar */}
      <div className="filters-bar">
        <form onSubmit={handleSearchSubmit} className="search-form">
          <div className="search-input-wrapper">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              className="form-input search-input"
              placeholder="Search by email or phone number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => {
                  setSearch('');
                  fetchUsers(1, '', statusFilter);
                }}
              >
                ✕
              </button>
            )}
          </div>
          <button type="submit" className="btn-primary btn-sm" disabled={loading}>
            Search
          </button>
        </form>

        <div className="filter-dropdown-group">
          <label htmlFor="status-filter" className="filter-label">Filter Status:</label>
          <select
            id="status-filter"
            className="form-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Accounts</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="banned">Banned</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>User ID</th>
              <th>Identifier (Email / Phone)</th>
              <th>Availability</th>
              <th>Status</th>
              <th>Reports</th>
              <th>Wallet</th>
              <th>Registered</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" className="table-empty-cell">
                  <div className="auth-spinner" style={{ margin: '20px auto' }}></div>
                  <p>Loading users...</p>
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan="8" className="table-empty-cell">
                  <span className="empty-icon">👥</span>
                  <p>No user accounts matched the search criteria.</p>
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isBanned = u.status === 'banned';
                const isSuspended = u.status === 'suspended';
                const isBusy = actionLoadingId === u.id;

                return (
                  <tr key={u.id}>
                    <td>
                      <code className="uuid-tag" title={u.id}>
                        {u.id.substring(0, 8)}...
                      </code>
                    </td>
                    <td>
                      <div className="user-identity">
                        <span className="user-email">{u.email || 'No email registered'}</span>
                        {u.phone && <span className="user-phone">{u.phone}</span>}
                      </div>
                    </td>
                    <td>
                      {u.is_available ? (
                        <span className="availability-pill avail-online">
                          <span className="dot dot-green"></span> Available
                        </span>
                      ) : (
                        <span className="availability-pill avail-offline">
                          <span className="dot dot-gray"></span> Offline
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`status-pill pill-${u.status}`}>
                        {u.status}
                      </span>
                    </td>
                    <td>
                      {u.reports_count > 0 ? (
                        <span className="badge-report-count">
                          ⚠️ {u.reports_count}
                        </span>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                    <td>
                      <span className="wallet-amount">
                        ₹{Number(u.wallet_balance || 0).toFixed(2)}
                      </span>
                    </td>
                    <td>
                      <span className="timestamp-text">
                        {new Date(u.created_at).toLocaleDateString()}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="table-actions">
                        {isBanned ? (
                          <button
                            type="button"
                            className="btn-action-unban"
                            onClick={() => handleStatusChange(u.id, 'active', 'Admin reinstated user')}
                            disabled={isBusy}
                          >
                            {isBusy ? 'Updating...' : 'Unban'}
                          </button>
                        ) : (
                          <>
                            {isSuspended ? (
                              <button
                                type="button"
                                className="btn-action-unban"
                                onClick={() => handleStatusChange(u.id, 'active', 'Admin lifted suspension')}
                                disabled={isBusy}
                              >
                                {isBusy ? 'Updating...' : 'Reactivate'}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn-action-ban"
                              onClick={() => {
                                setBanModalUser(u);
                                setBanReason('Violation of platform safety guidelines');
                              }}
                              disabled={isBusy}
                            >
                              Ban
                            </button>
                          </>
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
          Showing Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages || 1}</strong> ({pagination.total} total accounts)
        </span>
        <div className="pagination-buttons">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={pagination.page <= 1 || loading}
            onClick={() => fetchUsers(pagination.page - 1)}
          >
            ← Previous
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={pagination.page >= pagination.totalPages || loading}
            onClick={() => fetchUsers(pagination.page + 1)}
          >
            Next →
          </button>
        </div>
      </div>

      {/* Ban Confirmation Modal */}
      {banModalUser && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-icon-warning">🚫</div>
              <h3 className="modal-title">Confirm User Ban</h3>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to permanently ban user{' '}
                <strong>{banModalUser.email || banModalUser.phone || banModalUser.id}</strong>?
              </p>
              <div className="form-group" style={{ marginTop: '10px' }}>
                <label htmlFor="ban-reason-input">Reason for Ban:</label>
                <input
                  id="ban-reason-input"
                  type="text"
                  className="form-input"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="e.g. Inappropriate audio conduct, abuse"
                />
              </div>
              <div className="modal-callout">
                Banning this user terminates all active sessions immediately and prevents them from connecting or placing calls.
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setBanModalUser(null)}
                disabled={Boolean(actionLoadingId)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger-primary"
                onClick={() => handleStatusChange(banModalUser.id, 'banned', banReason)}
                disabled={Boolean(actionLoadingId)}
              >
                {actionLoadingId ? 'Banning...' : 'Confirm Ban'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default UsersPage;
