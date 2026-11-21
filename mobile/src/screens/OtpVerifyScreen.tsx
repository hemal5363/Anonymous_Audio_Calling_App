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
import { useNavigation, useRoute } from '@react-navigation/native';
import { OtpVerifyScreenNavigationProp, OtpVerifyScreenRouteProp } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';

export default function OtpVerifyScreen() {
  const navigation = useNavigation<OtpVerifyScreenNavigationProp>();
  const route = useRoute<OtpVerifyScreenRouteProp>();
  const { verifyOtp, requestOtp } = useAuth();

  const phone = route.params?.phone || '';
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Countdown timer for resend
  const [countdown, setCountdown] = useState<number>(60);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleVerify = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanOtp = otp.trim();
    if (!cleanOtp) {
      setErrorMessage('Please enter the 6-digit code.');
      return;
    }
    if (cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
      setErrorMessage('Verification code must be exactly 6 numeric digits.');
      return;
    }

    setLoading(true);
    try {
      await verifyOtp(phone, cleanOtp);
      // Navigation is handled automatically by RootNavigator via isAuthenticated
    } catch (err: any) {
      const msg = err?.message || 'Invalid or expired code. Please try again.';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || resending) return;

    setErrorMessage(null);
    setResending(true);
    try {
      await requestOtp(phone);
      setSuccessMessage('A new verification code has been sent.');
      setCountdown(60);
    } catch (err: any) {
      const msg = err?.message || 'Failed to resend code. Please try again later.';
      setErrorMessage(msg);
    } finally {
      setResending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>Enter Verification Code</Text>
          <Text style={styles.subtitle}>
            A 6-digit code was sent to <Text style={styles.highlightText}>{phone}</Text>
          </Text>

          {/* Success Banner */}
          {successMessage ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>{successMessage}</Text>
            </View>
          ) : null}

          {/* Error Banner */}
          {errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <Text style={styles.inputLabel}>6-Digit OTP</Text>
            <TextInput
              style={styles.otpInput}
              placeholder="123456"
              placeholderTextColor="#64748b"
              value={otp}
              onChangeText={(text) => {
                setOtp(text.replace(/[^0-9]/g, '').slice(0, 6));
              }}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />

            <TouchableOpacity
              style={[styles.submitButton, loading && styles.submitButtonDisabled]}
              onPress={handleVerify}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.submitButtonText}>Verify & Sign In</Text>
              )}
            </TouchableOpacity>

            {/* Resend Section */}
            <View style={styles.resendContainer}>
              {countdown > 0 ? (
                <Text style={styles.countdownText}>
                  Resend code in <Text style={styles.timerBold}>{countdown}s</Text>
                </Text>
              ) : (
                <TouchableOpacity onPress={handleResend} disabled={resending}>
                  <Text style={styles.resendLink}>
                    {resending ? 'Sending...' : 'Resend Code'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Change Number Link */}
            <TouchableOpacity
              style={styles.changePhoneButton}
              onPress={() => navigation.navigate('Login')}
            >
              <Text style={styles.changePhoneText}>← Use a different phone number</Text>
            </TouchableOpacity>
          </View>
        </View>
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
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f8fafc',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 20,
  },
  highlightText: {
    color: '#38bdf8',
    fontWeight: '600',
  },
  successBox: {
    backgroundColor: '#064e3b',
    borderWidth: 1,
    borderColor: '#059669',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  successText: {
    color: '#6ee7b7',
    fontSize: 13,
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
  },
  form: {
    width: '100%',
  },
  inputLabel: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  otpInput: {
    backgroundColor: '#0f172a',
    borderWidth: 2,
    borderColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 14,
    fontSize: 26,
    fontWeight: 'bold',
    color: '#f8fafc',
    textAlign: 'center',
    letterSpacing: 10,
  },
  submitButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  resendContainer: {
    alignItems: 'center',
    marginTop: 18,
  },
  countdownText: {
    color: '#64748b',
    fontSize: 13,
  },
  timerBold: {
    color: '#cbd5e1',
    fontWeight: 'bold',
  },
  resendLink: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '600',
  },
  changePhoneButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  changePhoneText: {
    color: '#94a3b8',
    fontSize: 13,
  },
});
