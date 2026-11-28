import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Linking,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { usePublicConfig } from '../config/PublicConfigContext';

interface ConsentScreenProps {
  termsVersion: string;
  privacyVersion: string;
}

export default function ConsentScreen({ termsVersion, privacyVersion }: ConsentScreenProps) {
  const { config, acceptUpdatedConsent } = usePublicConfig();
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const handleOpenPrivacy = () => {
    Linking.openURL(config.legal.privacy_policy_url).catch(() => {});
  };

  const handleOpenTerms = () => {
    Linking.openURL(config.legal.terms_of_service_url).catch(() => {});
  };

  const handleConfirmConsent = async () => {
    if (!accepted) return;
    setSubmitting(true);
    try {
      await acceptUpdatedConsent(termsVersion, privacyVersion);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Text style={styles.icon}>📋</Text>
          </View>

          <Text style={styles.title}>Updated Terms & Policy</Text>
          <Text style={styles.message}>
            We have updated our Terms of Service (v{termsVersion}) and Privacy Policy (v{privacyVersion}).
            To continue using Anonymous Audio Calling, please review and accept the updated agreements.
          </Text>

          <View style={styles.linksContainer}>
            <TouchableOpacity style={styles.linkButton} onPress={handleOpenTerms} activeOpacity={0.7}>
              <Text style={styles.linkButtonText}>📄 Read Terms of Service (v{termsVersion})</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.linkButton} onPress={handleOpenPrivacy} activeOpacity={0.7}>
              <Text style={styles.linkButtonText}>🔒 Read Privacy Policy (v{privacyVersion})</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAccepted(!accepted)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, accepted && styles.checkboxActive]}>
              {accepted && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkboxLabel}>
              I have read and agree to the updated Terms of Service and Privacy Policy.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, !accepted && styles.buttonDisabled]}
            disabled={!accepted || submitting}
            onPress={handleConfirmConsent}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.buttonText}>I Agree & Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f1d',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 28,
    width: '100%',
    maxWidth: 440,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(79, 70, 229, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  icon: {
    fontSize: 34,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  linksContainer: {
    width: '100%',
    gap: 10,
    marginBottom: 24,
  },
  linkButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  linkButtonText: {
    color: '#818cf8',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    marginBottom: 24,
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4f46e5',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  checkboxActive: {
    backgroundColor: '#4f46e5',
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    color: '#cbd5e1',
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#4f46e5',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
