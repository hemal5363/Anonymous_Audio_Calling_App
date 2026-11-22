import React from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Linking,
} from 'react-native';

interface PrivacyPolicyModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function PrivacyPolicyModal({ visible, onClose }: PrivacyPolicyModalProps) {
  const handleOpenBrowser = async () => {
    try {
      await Linking.openURL('https://anonaudiocall.com/privacy');
    } catch {
      // Browser not available or URL unresolvable in test
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Privacy Policy</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.7}>
            <Text style={styles.closeButtonText}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <Text style={styles.lastUpdated}>Effective & Last Updated: November 22, 2026</Text>

          {/* Core Guarantee Highlight */}
          <View style={styles.highlightCard}>
            <Text style={styles.highlightTitle}>🔒 Core Guarantee: Zero Peer Identity & No Audio Recording</Text>
            <Text style={styles.highlightText}>
              • <Text style={styles.bold}>Zero Peer Identity:</Text> Your real name, email, phone number, and IP address are NEVER shown to other users. You are only identified as an "Anonymous Caller".{'\n\n'}
              • <Text style={styles.bold}>No Audio Recording:</Text> Calls are connected directly peer-to-peer using end-to-end encrypted WebRTC. We do NOT record, listen to, transcribe, or store audio on any server. No audio files exist.
            </Text>
          </View>

          {/* Section 1: Information Collected */}
          <Text style={styles.sectionHeader}>1. Information We Collect</Text>
          <Text style={styles.paragraph}>
            We collect only the minimal data required for authentication, abuse prevention, and call routing:
          </Text>
          <View style={styles.bulletList}>
            <Text style={styles.bulletPoint}>
              • <Text style={styles.bold}>Email Address (Optional):</Text> Used for password-based account login.
            </Text>
            <Text style={styles.bulletPoint}>
              • <Text style={styles.bold}>Phone Number:</Text> Used solely for SMS OTP verification if mobile login is enabled.
            </Text>
            <Text style={styles.bulletPoint}>
              • <Text style={styles.bold}>Call Metadata:</Text> Timestamps, duration in seconds, anonymous session IDs, and termination status. Used for connection reliability and billing.
            </Text>
            <Text style={styles.bulletPoint}>
              • <Text style={styles.bold}>Expo Push Notification Token:</Text> A randomized device push token used exclusively to ring your phone when an incoming call arrives while the app is closed.
            </Text>
          </View>

          {/* Section 2: Storage & Security */}
          <Text style={styles.sectionHeader}>2. Storage & Security</Text>
          <Text style={styles.paragraph}>
            • <Text style={styles.bold}>Hardware-Backed Storage:</Text> On mobile devices, authentication tokens are stored exclusively in expo-secure-store (Android Keystore / iOS Keychain). Tokens are never written to AsyncStorage or exposed in application logs.{'\n'}
            • <Text style={styles.bold}>Stripped Console Logs:</Text> Release builds automatically strip all console logs to prevent sensitive data leakage.{'\n'}
            • <Text style={styles.bold}>Transport Security:</Text> All API endpoints require HTTPS/TLS 1.3, and WebRTC uses DTLS/SRTP encryption.
          </Text>

          {/* Section 3: Permissions */}
          <Text style={styles.sectionHeader}>3. Device Permissions</Text>
          <Text style={styles.paragraph}>
            • <Text style={styles.bold}>Microphone:</Text> Activated solely during an active voice call. You can revoke it anytime in Settings.{'\n'}
            • <Text style={styles.bold}>Notifications:</Text> Used to alert you to incoming calls when the app is in the background. If denied, the app still works when open.
          </Text>

          {/* Section 4: Account Deletion (Google Play Required) */}
          <Text style={styles.sectionHeader}>4. Account Deletion (Google Play Compliance)</Text>
          <Text style={styles.paragraph}>
            You have the right to delete your account and all associated data at any time. Inside the App, navigate to{' '}
            <Text style={styles.bold}>Settings & Account → Delete My Account</Text>. Upon deletion:
          </Text>
          <View style={styles.bulletList}>
            <Text style={styles.bulletPoint}>• Credentials, email, and phone records are permanently erased.</Text>
            <Text style={styles.bulletPoint}>• Push notification tokens are immediately unregistered and removed.</Text>
            <Text style={styles.bulletPoint}>• Historical call logs are permanently anonymized and unlinked.</Text>
          </View>

          {/* Browser Link Option */}
          <TouchableOpacity style={styles.browserButton} onPress={handleOpenBrowser} activeOpacity={0.8}>
            <Text style={styles.browserButtonText}>🌐 View Hosted Privacy Policy Online</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0f1d',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1e293b',
    borderRadius: 8,
  },
  closeButtonText: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '600',
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  lastUpdated: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 16,
  },
  highlightCard: {
    backgroundColor: '#064e3b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#059669',
  },
  highlightTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#34d399',
    marginBottom: 8,
  },
  highlightText: {
    fontSize: 13,
    color: '#d1fae5',
    lineHeight: 19,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
    marginTop: 18,
    marginBottom: 10,
  },
  paragraph: {
    fontSize: 13,
    color: '#cbd5e1',
    lineHeight: 20,
    marginBottom: 10,
  },
  bulletList: {
    paddingLeft: 4,
    marginBottom: 12,
  },
  bulletPoint: {
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 20,
    marginBottom: 6,
  },
  bold: {
    fontWeight: '700',
    color: '#f8fafc',
  },
  browserButton: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#38bdf8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  browserButtonText: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '700',
  },
});
