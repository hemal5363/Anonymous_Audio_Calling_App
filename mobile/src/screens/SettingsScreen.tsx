import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SettingsScreenNavigationProp } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';
import PrivacyPolicyModal from '../components/PrivacyPolicyModal';

export default function SettingsScreen() {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { user, deleteAccount, logout } = useAuth();
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState<boolean>(false);

  const handleDeleteAccountPress = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to permanently delete your account?\n\n' +
        '• Your email, phone, and credentials will be completely erased from our servers.\n' +
        '• All historical calls and reports will be permanently anonymized.\n' +
        '• This action is immediate and cannot be undone (Google Play compliant).',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await deleteAccount();
              // After account deletion, logout clears tokens and redirects to Login
            } catch (err: any) {
              setIsDeleting(false);
              const message =
                err?.message || 'Failed to delete account. Please check your connection and try again.';
              Alert.alert('Deletion Error', message);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Account Info Section */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>👤 Account Information</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Account ID</Text>
            <Text style={styles.value} numberOfLines={1} ellipsizeMode="middle">
              {user?.id || '—'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Identity</Text>
            <Text style={styles.value}>
              {user?.email || user?.phone || 'Anonymous'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>{user?.status || 'Active'}</Text>
            </View>
          </View>
        </View>

        {/* Privacy & Compliance Section */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>🔒 Privacy & Compliance</Text>
          <Text style={styles.description}>
            Anonymous Audio does not track or store call recordings. We strictly protect your identity
            during audio interactions.
          </Text>

          <View style={styles.bulletItem}>
            <Text style={styles.bulletDot}>•</Text>
            <Text style={styles.bulletText}>
              <Text style={styles.bold}>Zero Peer Identity:</Text> Your email, phone number, and IP
              address are never revealed to call partners.
            </Text>
          </View>
          <View style={styles.bulletItem}>
            <Text style={styles.bulletDot}>•</Text>
            <Text style={styles.bulletText}>
              <Text style={styles.bold}>Google Play Data Safety:</Text> Users have the right to request
              complete data erasure at any time.
            </Text>
          </View>
          <View style={styles.bulletItem}>
            <Text style={styles.bulletDot}>•</Text>
            <Text style={styles.bulletText}>
              <Text style={styles.bold}>Terms & Privacy:</Text> Version 1.0 active.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.privacyLinkButton}
            onPress={() => setShowPrivacyModal(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.privacyLinkButtonText}>📄 Read Full Privacy Policy</Text>
          </TouchableOpacity>
        </View>

        {/* Danger Zone: Account Deletion (Google Play Required) */}
        <View style={styles.dangerCard}>
          <Text style={styles.dangerHeader}>⚠️ Danger Zone</Text>
          <Text style={styles.dangerText}>
            Deleting your account will permanently remove your login credentials, email or phone
            association, and push notification tokens. Historical records are completely unlinked and
            anonymized.
          </Text>

          <TouchableOpacity
            style={[styles.deleteButton, isDeleting && styles.deleteButtonDisabled]}
            onPress={handleDeleteAccountPress}
            disabled={isDeleting}
            activeOpacity={0.8}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.deleteButtonText}>🗑️ Delete My Account</Text>
            )}
          </TouchableOpacity>
        </View>

        <PrivacyPolicyModal
          visible={showPrivacyModal}
          onClose={() => setShowPrivacyModal(false)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0f1d',
  },
  container: {
    flex: 1,
    backgroundColor: '#0a0f1d',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#131b2e',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 20,
  },
  cardHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  label: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '500',
  },
  value: {
    fontSize: 13,
    color: '#f8fafc',
    fontWeight: '600',
    maxWidth: 200,
  },
  statusBadge: {
    backgroundColor: '#064e3b',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  description: {
    fontSize: 13,
    color: '#cbd5e1',
    lineHeight: 19,
    marginBottom: 12,
  },
  bulletItem: {
    flexDirection: 'row',
    marginBottom: 8,
    paddingRight: 10,
  },
  bulletDot: {
    fontSize: 14,
    color: '#38bdf8',
    marginRight: 8,
    marginTop: 1,
  },
  bulletText: {
    flex: 1,
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 18,
  },
  bold: {
    fontWeight: '700',
    color: '#cbd5e1',
  },
  dangerCard: {
    backgroundColor: '#1c1117',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    marginBottom: 20,
  },
  dangerHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f87171',
    marginBottom: 8,
  },
  dangerText: {
    fontSize: 12,
    color: '#fca5a5',
    lineHeight: 18,
    marginBottom: 16,
  },
  deleteButton: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  privacyLinkButton: {
    marginTop: 12,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#38bdf8',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyLinkButtonText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
  },
});
