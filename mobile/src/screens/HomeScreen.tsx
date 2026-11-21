import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';

export default function HomeScreen() {
  const { user, logout, updateUser } = useAuth();
  const [togglingAvailability, setTogglingAvailability] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const isAvailable = Boolean(user?.is_available);

  const handleToggleAvailability = async (value: boolean) => {
    setTogglingAvailability(true);
    try {
      const res = await api.put<{ is_available: boolean }>('/user/availability', {
        is_available: value,
      });
      updateUser({ is_available: res.is_available });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not update availability.');
    } finally {
      setTogglingAvailability(false);
    }
  };

  const handleLogoutPress = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of Anonymous Audio?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            setLoggingOut(true);
            try {
              await logout();
            } finally {
              setLoggingOut(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Bar */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appTitle}>Anonymous Audio</Text>
          <Text style={styles.userIdText}>
            Logged in as: {user?.email || user?.phone || 'Anonymous'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogoutPress}
          disabled={loggingOut}
        >
          {loggingOut ? (
            <ActivityIndicator size="small" color="#f87171" />
          ) : (
            <Text style={styles.logoutButtonText}>Log Out</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Availability Card */}
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle}>Available for Calls</Text>
            <Text style={styles.cardSubtitle}>
              When ON, other users can connect with you.
            </Text>
          </View>
          {togglingAvailability ? (
            <ActivityIndicator size="small" color="#38bdf8" />
          ) : (
            <Switch
              value={isAvailable}
              onValueChange={handleToggleAvailability}
              trackColor={{ false: '#334155', true: '#2563eb' }}
              thumbColor={isAvailable ? '#38bdf8' : '#94a3b8'}
            />
          )}
        </View>

        <View style={styles.statusPillRow}>
          <View style={[styles.statusDot, isAvailable ? styles.dotGreen : styles.dotGray]} />
          <Text style={styles.statusPillText}>
            Status: {isAvailable ? 'Available to receive calls' : 'Offline / Unavailable'}
          </Text>
        </View>
      </View>

      {/* Center Call Zone */}
      <View style={styles.callZone}>
        <TouchableOpacity style={styles.callCircle} activeOpacity={0.85}>
          <Text style={styles.callCircleText}>CALL</Text>
        </TouchableOpacity>
        <Text style={styles.callSubtitle}>Tap CALL to connect with a random partner</Text>
      </View>

      {/* Privacy Banner */}
      <View style={styles.privacyBanner}>
        <Text style={styles.privacyTitle}>🔒 100% Anonymous</Text>
        <Text style={styles.privacyBody}>
          Your name, number, email, and IP address are never exposed to callers.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f1d',
  },
  content: {
    padding: 20,
    paddingTop: 30,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  userIdText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  logoutButton: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  logoutButtonText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#131b2e',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 24,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    marginRight: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 4,
  },
  statusPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  dotGreen: {
    backgroundColor: '#22c55e',
  },
  dotGray: {
    backgroundColor: '#64748b',
  },
  statusPillText: {
    fontSize: 12,
    color: '#cbd5e1',
    fontWeight: '500',
  },
  callZone: {
    alignItems: 'center',
    marginVertical: 40,
  },
  callCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
    borderWidth: 4,
    borderColor: '#38bdf8',
  },
  callCircleText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 2,
  },
  callSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 16,
    textAlign: 'center',
  },
  privacyBanner: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginTop: 20,
  },
  privacyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#38bdf8',
    marginBottom: 4,
  },
  privacyBody: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 18,
  },
});
