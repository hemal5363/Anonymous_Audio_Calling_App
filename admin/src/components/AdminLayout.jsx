import React, { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import { useAuth } from '../auth/useAuth.js';
import ChangePasswordModal from './ChangePasswordModal.jsx';

export function AdminLayout() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="admin-layout">
      {/* Fixed Left Sidebar */}
      <Sidebar />

      {/* Main Container */}
      <div className="admin-main">
        {/* Top Header Bar */}
        <header className="admin-header">
          <div className="header-breadcrumbs">
            <span className="platform-name">Anonymous Calling Administration</span>
          </div>

          <div className="header-actions">
            <div className="admin-profile">
              <span className="admin-avatar">
                {admin?.email ? admin.email.charAt(0).toUpperCase() : 'A'}
              </span>
              <div className="admin-details">
                <span className="admin-email">{admin?.email || 'admin@example.com'}</span>
                <span className="admin-role-badge">{admin?.role || 'Administrator'}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              className="btn-secondary btn-sm"
              title="Change Admin Password"
              id="admin-change-password-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              <span>Change Password</span>
            </button>

            <button
              onClick={handleLogout}
              className="btn-logout"
              title="Sign out of Admin Console"
              id="admin-logout-btn"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Dynamic Nested Page Content */}
        <main className="admin-content">
          <Outlet />
        </main>

        <ChangePasswordModal
          isOpen={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
        />
      </div>
    </div>
  );
}

export default AdminLayout;
