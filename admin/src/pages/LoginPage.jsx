import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // If already authenticated, redirect to destination in state or dashboard (never expose token in URL)
  useEffect(() => {
    if (isAuthenticated) {
      const destination = location.state?.from?.pathname || '/';
      navigate(destination, { replace: true });
    }
  }, [isAuthenticated, location.state, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!email.trim() || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await login({
        email: email.trim(),
        password,
        totp_code: totpCode.trim() || undefined,
      });

      if (res.success) {
        const destination = location.state?.from?.pathname || '/';
        navigate(destination, { replace: true });
      } else {
        const message =
          res.error?.details?.message ||
          res.error?.message ||
          'Authentication failed. Please verify credentials.';
        setErrorMsg(message);
      }
    } catch (err) {
      setErrorMsg(err.message || 'An unexpected error occurred during login.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8.009 8.009 0 0 1-8 8z" />
            </svg>
          </div>
          <h2 className="login-title">Admin Console</h2>
          <p className="login-subtitle">Sign in with authorized administrator credentials</p>
        </div>

        {errorMsg && (
          <div className="login-error-alert" role="alert">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form" noValidate>
          <div className="form-group">
            <label htmlFor="admin-email">Admin Email</label>
            <input
              id="admin-email"
              type="email"
              className="form-input"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              autoComplete="username"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              className="form-input"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              autoComplete="current-password"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="admin-totp">
              TOTP / 2FA Code <span className="label-optional">(Optional)</span>
            </label>
            <input
              id="admin-totp"
              type="text"
              maxLength={6}
              className="form-input"
              placeholder="123456"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              disabled={submitting}
              autoComplete="one-time-code"
            />
          </div>

          <button
            type="submit"
            className="btn-primary btn-block"
            disabled={submitting}
          >
            {submitting ? 'Authenticating...' : 'Log In to Admin Console'}
          </button>
        </form>

        <div className="login-footer">
          <span>Protected Area • Restricted Access Only</span>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
