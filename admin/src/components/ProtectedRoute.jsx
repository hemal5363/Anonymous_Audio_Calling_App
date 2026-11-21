import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';

export function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-spinner"></div>
        <p>Verifying admin authorization...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to /login with attempted destination in location.state (NOT in URL)
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

export default ProtectedRoute;
