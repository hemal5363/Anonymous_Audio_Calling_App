import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { HomeScreenNavigationProp } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';
import { useSocket } from '../socket/useSocket';
import { connectSocket } from '../socket';
import { useCall } from '../call/CallContext';
import { api } from '../api/client';

export default function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { user, logout, updateUser } = useAuth();
  const { isConnected, socketError } = useSocket();
  const { callStatus, startFind, lastEndInfo, clearEndInfo } = useCall();

  // Availability state
  const [isAvailable, setIsAvailable] = useState<boolean>(Boolean(user?.is_available));
  const [updatingAvailability, setUpdatingAvailability] = useState<boolean>(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const [loggingOut, setLoggingOut] = useState<boolean>(false);

  // Sync local availability state if context user changes
  useEffect(() => {
    setIsAvailable(Boolean(user?.is_available));
  }, [user?.is_available]);

  // Ensure socket connection is actively established when user is authenticated on HomeScreen
  useEffect(() => {
    if (user && !isConnected) {
      console.log('[HomeScreen] User authenticated, ensuring socket is connected...');
      connectSocket().catch((err) => {
        console.warn('[HomeScreen] connectSocket caught error:', err);
      });
    }
  }, [user, isConnected]);

  // Navigate reactively to call screens based on active call status
  useEffect(() => {
    if (callStatus === 'searching') {
      navigation.navigate('Searching');
    } else if (callStatus === 'incoming') {
      navigation.navigate('IncomingCall');
    } else if (callStatus === 'connected') {
      navigation.navigate('InCall');
    }
  }, [callStatus, navigation]);

  // Handle Availability Toggle with automatic rollback on error
  const handleToggleAvailability = async (nextValue: boolean) => {
    setAvailabilityError(null);
    const previousValue = isAvailable;

    // Optimistically set the switch UI
    setIsAvailable(nextValue);
    setUpdatingAvailability(true);

    try {
      const res = await api.put<{ is_available: boolean }>('/user/availability', {
        is_available: nextValue,
      });

      // Confirm with server response
      setIsAvailable(res.is_available);
      updateUser({ is_available: res.is_available });
    } catch (err: any) {
      // Revert switch to previous state
      setIsAvailable(previousValue);
      const errorMsg =
        err?.message || 'Failed to update availability. Please check your connection and try again.';
      setAvailabilityError(errorMsg);
      Alert.alert('Availability Error', errorMsg);
    } finally {
      setUpdatingAvailability(false);
    }
  };

  // Handle Call button press (enabled only when socket is connected)
  const handleCallPress = () => {
    if (!isConnected) {
      Alert.alert('Connection Required', 'Connecting to call server. Please wait a moment.');
      return;
    }

    // CallContext transitions status to 'searching' and emits call:find
    startFind();
  };

  // Handle Logout confirmation
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
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Top App Bar */}
        <View style={styles.header}>
          <View style={styles.headerBrand}>
            <Text style={styles.brandTitle}>Anonymous Audio</Text>
            <Text style={styles.brandSubtitle}>
              Logged in as: {user?.email || user?.phone || 'Anonymous'}
            </Text>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.walletHeaderButton}
              onPress={() => navigation.navigate('Wallet')}
              activeOpacity={0.7}
            >
              <Text style={styles.walletHeaderButtonText}>💳 Wallet</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.logoutButton}
              onPress={handleLogoutPress}
              disabled={loggingOut}
              activeOpacity={0.7}
            >
              {loggingOut ? (
                <ActivityIndicator size="small" color="#f87171" />
              ) : (
                <Text style={styles.logoutButtonText}>Log Out</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Server Connection Pill */}
        <View style={styles.connectionStatusContainer}>
          <View
            style={[
              styles.connectionDot,
              isConnected
                ? styles.dotConnected
                : socketError
                ? styles.dotError
                : styles.dotConnecting,
            ]}
          />
          <Text
            style={[
              styles.connectionStatusText,
              Boolean(socketError) && !isConnected && styles.connectionStatusErrorText,
            ]}
          >
            {isConnected
              ? 'Server Connected'
              : socketError
              ? `Socket: ${socketError}`
              : 'Connecting to server...'}
          </Text>
          {!isConnected && !socketError && (
            <ActivityIndicator size="small" color="#f59e0b" style={styles.connectingSpinner} />
          )}
          {!isConnected && socketError ? (
            <TouchableOpacity
              onPress={() => {
                console.log('[HomeScreen] User requested socket reconnect');
                connectSocket().catch(() => {});
              }}
              style={styles.retryPillButton}
              activeOpacity={0.7}
            >
              <Text style={styles.retryPillButtonText}>Retry</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Call Finished / End Reason Banner */}
        {lastEndInfo ? (
          <View style={styles.endInfoCard}>
            <View style={styles.endInfoHeaderRow}>
              <Text style={styles.endInfoTitle}>ℹ️ Call Notification</Text>
              <TouchableOpacity onPress={clearEndInfo} style={styles.dismissButton}>
                <Text style={styles.dismissButtonText}>✕ Dismiss</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.endInfoMessage}>{lastEndInfo.friendlyMessage}</Text>
            {lastEndInfo.durationSeconds ? (
              <Text style={styles.endInfoDuration}>
                Call duration: {Math.floor(lastEndInfo.durationSeconds / 60)}m{' '}
                {lastEndInfo.durationSeconds % 60}s
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Availability Error Banner */}
        {availabilityError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{availabilityError}</Text>
          </View>
        ) : null}

        {/* Availability Card */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardTextContainer}>
              <Text style={styles.cardTitle}>Available to receive calls</Text>
              <Text style={styles.cardSubtitle}>
                When ON, you can receive calls even when the app is closed.
              </Text>
            </View>

            {updatingAvailability ? (
              <ActivityIndicator size="small" color="#38bdf8" />
            ) : (
              <Switch
                value={isAvailable}
                onValueChange={handleToggleAvailability}
                trackColor={{ false: '#334155', true: '#2563eb' }}
                thumbColor={isAvailable ? '#38bdf8' : '#94a3b8'}
                disabled={updatingAvailability}
              />
            )}
          </View>

          <View style={styles.cardStatusDivider}>
            <View
              style={[
                styles.statusIndicatorDot,
                isAvailable ? styles.dotGreen : styles.dotGray,
              ]}
            />
            <Text style={styles.cardStatusLabel}>
              Status: {isAvailable ? 'Available to receive calls' : 'Offline / Unavailable'}
            </Text>
          </View>
        </View>

        {/* Central Call Zone */}
        <View style={styles.callZone}>
          <TouchableOpacity
            style={[
              styles.callButton,
              isConnected ? styles.callButtonActive : styles.callButtonDisabled,
            ]}
            onPress={handleCallPress}
            disabled={!isConnected}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.callButtonText,
                !isConnected && styles.callButtonTextDisabled,
              ]}
            >
              CALL
            </Text>
          </TouchableOpacity>

          <Text style={styles.callZoneSubtitle}>
            {isConnected
              ? 'Tap CALL to connect with an available partner'
              : socketError
              ? `Socket: ${socketError}`
              : 'Waiting for server connection to enable calls...'}
          </Text>
        </View>

        {/* Quick Access Card to Wallet & Call History */}
        <TouchableOpacity
          style={styles.walletCardButton}
          onPress={() => navigation.navigate('Wallet')}
          activeOpacity={0.8}
        >
          <View style={styles.walletCardLeft}>
            <Text style={styles.walletCardTitle}>💳 Wallet & Call History</Text>
            <Text style={styles.walletCardSubtitle}>
              View active plan/balance & anonymous call history
            </Text>
          </View>
          <Text style={styles.walletCardArrow}>→</Text>
        </TouchableOpacity>

        {/* Strict Privacy Guarantee Box (Universal Design Rule: Zero Peer Identity) */}
        <View style={styles.privacyBox}>
          <Text style={styles.privacyHeader}>🔒 Strict Anonymity Guarantee</Text>
          <Text style={styles.privacyText}>
            • No name, email, phone number, or IP address is ever shown to peers.{'\n'}
            • You are only identified as an "Anonymous Caller".{'\n'}
            • All audio is encrypted and private.
          </Text>
        </View>
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
    paddingTop: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  headerBrand: {
    flex: 1,
    marginRight: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  walletHeaderButton: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#38bdf8',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  walletHeaderButtonText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  walletCardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  walletCardLeft: {
    flex: 1,
    marginRight: 10,
  },
  walletCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 4,
  },
  walletCardSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
  },
  walletCardArrow: {
    fontSize: 18,
    color: '#38bdf8',
    fontWeight: '700',
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
  connectionStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 18,
  },
  connectionDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  dotConnected: {
    backgroundColor: '#22c55e',
  },
  dotConnecting: {
    backgroundColor: '#f59e0b',
  },
  dotError: {
    backgroundColor: '#ef4444',
  },
  connectionStatusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#cbd5e1',
  },
  connectionStatusErrorText: {
    color: '#fca5a5',
  },
  retryPillButton: {
    marginLeft: 8,
    backgroundColor: '#334155',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#475569',
  },
  retryPillButtonText: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '700',
  },
  connectingSpinner: {
    marginLeft: 6,
    transform: [{ scale: 0.7 }],
  },
  endInfoCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  endInfoHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  endInfoTitle: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: 'bold',
  },
  dismissButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dismissButtonText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  endInfoMessage: {
    color: '#f8fafc',
    fontSize: 14,
    lineHeight: 20,
  },
  endInfoDuration: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 6,
  },
  errorBanner: {
    backgroundColor: '#450a0a',
    borderWidth: 1,
    borderColor: '#b91c1c',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorBannerText: {
    color: '#fca5a5',
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#131b2e',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTextContainer: {
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
    lineHeight: 18,
  },
  cardStatusDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  statusIndicatorDot: {
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
  cardStatusLabel: {
    fontSize: 12,
    color: '#cbd5e1',
    fontWeight: '500',
  },
  callZone: {
    alignItems: 'center',
    marginVertical: 36,
  },
  callButton: {
    width: 150,
    height: 150,
    borderRadius: 75,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 10,
  },
  callButtonActive: {
    backgroundColor: '#2563eb',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    borderWidth: 4,
    borderColor: '#38bdf8',
  },
  callButtonDisabled: {
    backgroundColor: '#1e293b',
    borderWidth: 4,
    borderColor: '#334155',
    opacity: 0.6,
  },
  callButtonText: {
    fontSize: 26,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 2,
  },
  callButtonTextDisabled: {
    color: '#64748b',
  },
  callZoneSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 18,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 18,
  },
  privacyBox: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginTop: 16,
  },
  privacyHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#38bdf8',
    marginBottom: 6,
  },
  privacyText: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 20,
  },
});
