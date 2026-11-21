import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import { useAuth } from '../auth/useAuth.js';

export function AdminLayout() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();

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
      </div>
    </div>
  );
}

export default AdminLayout;
