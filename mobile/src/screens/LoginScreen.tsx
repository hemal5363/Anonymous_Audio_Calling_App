import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LoginScreenNavigationProp } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';
import { getAuthConfig } from '../api/auth';
import PrivacyPolicyModal from '../components/PrivacyPolicyModal';

export default function LoginScreen() {
  const navigation = useNavigation<LoginScreenNavigationProp>();
  const { login, requestOtp } = useAuth();

  const [authMode, setAuthMode] = useState<'email' | 'phone'>('email');
  const [mobileLoginEnabled, setMobileLoginEnabled] = useState<boolean>(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState<boolean>(false);

  // Email form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Phone form state
  const [phone, setPhone] = useState('');

  // UI state
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch backend public config to check if mobile login is enabled
  useEffect(() => {
    let isMounted = true;
    getAuthConfig().then((cfg) => {
      if (isMounted) {
        setMobileLoginEnabled(cfg.mobile_login_enabled);
        if (!cfg.mobile_login_enabled) {
          setAuthMode('email');
        }
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const validateEmail = (val: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(val.trim());
  };

  const validatePhone = (val: string) => {
    // E.164 format: + followed by 7 to 15 digits
    const re = /^\+[1-9]\d{6,14}$/;
    return re.test(val.trim());
  };

  const handleEmailLogin = async () => {
    setErrorMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!validateEmail(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      await login(cleanEmail, password);
      // Navigation is handled automatically by RootNavigator via isAuthenticated
    } catch (err: any) {
      const msg = err?.message || 'Login failed. Please check your credentials.';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneSubmit = async () => {
    setErrorMessage(null);

    const cleanPhone = phone.trim();
    if (!cleanPhone) {
      setErrorMessage('Please enter your phone number.');
      return;
    }
    if (!validatePhone(cleanPhone)) {
      setErrorMessage('Phone must include country code in E.164 format (e.g. +919876543210).');
      return;
    }

    setLoading(true);
    try {
      await requestOtp(cleanPhone);
      navigation.navigate('OtpVerify', { phone: cleanPhone });
    } catch (err: any) {
      const msg = err?.message || 'Failed to send OTP code. Please try again.';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          {/* Header */}
          <Text style={styles.appTitle}>Anonymous Audio</Text>
          <Text style={styles.appSubtitle}>Sign in to start one-to-one voice calls</Text>

          {/* Optional Mode Switcher: Only displayed when backend enables mobile login */}
          {mobileLoginEnabled && (
            <View style={styles.tabContainer}>
              <TouchableOpacity
                style={[styles.tabButton, authMode === 'email' && styles.tabButtonActive]}
                onPress={() => {
                  setAuthMode('email');
                  setErrorMessage(null);
                }}
              >
                <Text style={[styles.tabButtonText, authMode === 'email' && styles.tabButtonTextActive]}>
                  Email & Password
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabButton, authMode === 'phone' && styles.tabButtonActive]}
                onPress={() => {
                  setAuthMode('phone');
                  setErrorMessage(null);
                }}
              >
                <Text style={[styles.tabButtonText, authMode === 'phone' && styles.tabButtonTextActive]}>
                  Mobile OTP
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Error Banner */}
          {errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* Form Content */}
          {authMode === 'email' ? (
            <View style={styles.form}>
              <Text style={styles.inputLabel}>Email Address</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#64748b"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />

              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.passwordWrapper}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="Enter your password"
                  placeholderTextColor="#64748b"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.showPasswordButton}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Text style={styles.showPasswordText}>{showPassword ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                onPress={handleEmailLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.submitButtonText}>Sign In</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.inputLabel}>Mobile Phone Number</Text>
              <TextInput
                style={styles.input}
                placeholder="+919876543210"
                placeholderTextColor="#64748b"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoCapitalize="none"
              />
              <Text style={styles.helperText}>
                Include your country code (e.g. +91 for India, +1 for US). A 6-digit verification code will be sent.
              </Text>

              <TouchableOpacity
                style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                onPress={handlePhoneSubmit}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.submitButtonText}>Send Verification Code</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Footer Navigation */}
          <View style={styles.footerContainer}>
            <Text style={styles.footerText}>Don't have an account?</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Register')}>
              <Text style={styles.footerLink}> Create Account</Text>
            </TouchableOpacity>
          </View>

          {/* Privacy Policy Link (Google Play Requirement) */}
          <View style={styles.privacyFooterContainer}>
            <TouchableOpacity onPress={() => setShowPrivacyModal(true)} activeOpacity={0.7}>
              <Text style={styles.privacyFooterLink}>Privacy Policy & Data Safety</Text>
            </TouchableOpacity>
          </View>
        </View>

        <PrivacyPolicyModal
          visible={showPrivacyModal}
          onClose={() => setShowPrivacyModal(false)}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardContainer: {
    flex: 1,
    backgroundColor: '#0a0f1d',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#131b2e',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1e293b',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  appTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f8fafc',
    textAlign: 'center',
  },
  appSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 4,
    marginBottom: 20,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabButtonActive: {
    backgroundColor: '#2563eb',
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  tabButtonTextActive: {
    color: '#ffffff',
  },
  errorBox: {
    backgroundColor: '#450a0a',
    borderWidth: 1,
    borderColor: '#b91c1c',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    lineHeight: 18,
  },
  form: {
    width: '100%',
  },
  inputLabel: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#f8fafc',
  },
  passwordWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 60,
  },
  showPasswordButton: {
    position: 'absolute',
    right: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  showPasswordText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  helperText: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 6,
    lineHeight: 16,
  },
  submitButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  footerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
    alignItems: 'center',
  },
  footerText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  footerLink: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
  },
  privacyFooterContainer: {
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  privacyFooterLink: {
    color: '#64748b',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
});
