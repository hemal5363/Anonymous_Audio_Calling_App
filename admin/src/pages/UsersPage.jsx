import React from 'react';

export function UsersPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Users</h1>
        <p className="page-subtitle">Manage user accounts, ban/unban status, and view wallet balances</p>
      </div>

      <div className="placeholder-card">
        <div className="placeholder-icon">👥</div>
        <h3>User Directory (Placeholder)</h3>
        <p>Anonymous user listings, status management, search filters, and suspension controls will be rendered here.</p>
      </div>
    </div>
  );
}

export default UsersPage;
