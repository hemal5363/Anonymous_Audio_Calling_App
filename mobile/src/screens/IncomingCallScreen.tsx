import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { IncomingCallScreenNavigationProp } from '../navigation/types';
import { useCall } from '../call/CallContext';

export default function IncomingCallScreen() {
  const navigation = useNavigation<IncomingCallScreenNavigationProp>();
  const { callStatus, incomingCall, acceptIncoming, rejectIncoming } = useCall();

  // Ring timer countdown (30s)
  const [secondsRemaining, setSecondsRemaining] = useState<number>(
    incomingCall?.ringSeconds || 30
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          rejectIncoming();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [rejectIncoming]);

  // Navigate when call state changes
  useEffect(() => {
    if (callStatus === 'connected') {
      navigation.replace('InCall');
    } else if (callStatus === 'idle' || callStatus === 'ended') {
      navigation.replace('Home');
    }
  }, [callStatus, navigation]);

  const handleAccept = () => {
    acceptIncoming();
  };

  const handleDecline = () => {
    rejectIncoming();
    navigation.replace('Home');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Caller Avatar & Info */}
        <View style={styles.callerInfoContainer}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarIcon}>👤</Text>
          </View>

          {/* Strict Anonymity: No user name or phone is EVER shown */}
          <Text style={styles.anonymousTitle}>Incoming Anonymous Call</Text>
          <Text style={styles.anonymousSubtitle}>Internet Voice Audio</Text>

          {/* Ring countdown */}
          <View style={styles.countdownBadge}>
            <Text style={styles.countdownText}>Ringing ({secondsRemaining}s)</Text>
          </View>
        </View>

        {/* Dual Accept / Decline Action Buttons */}
        <View style={styles.actionRow}>
          {/* Decline Button */}
          <View style={styles.actionItem}>
            <TouchableOpacity
              style={[styles.actionCircle, styles.declineCircle]}
              onPress={handleDecline}
              activeOpacity={0.8}
            >
              <Text style={styles.actionIcon}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.actionLabel}>Decline</Text>
          </View>

          {/* Accept Button */}
          <View style={styles.actionItem}>
            <TouchableOpacity
              style={[styles.actionCircle, styles.acceptCircle]}
              onPress={handleAccept}
              activeOpacity={0.8}
            >
              <Text style={styles.actionIcon}>✓</Text>
            </TouchableOpacity>
            <Text style={styles.actionLabel}>Accept</Text>
          </View>
        </View>
      </View>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  callerInfoContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  avatarCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#1e293b',
    borderWidth: 3,
    borderColor: '#38bdf8',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  avatarIcon: {
    fontSize: 54,
  },
  anonymousTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#f8fafc',
    textAlign: 'center',
  },
  anonymousSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 6,
  },
  countdownBadge: {
    backgroundColor: '#1e293b',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginTop: 18,
    borderWidth: 1,
    borderColor: '#334155',
  },
  countdownText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 30,
  },
  actionItem: {
    alignItems: 'center',
  },
  actionCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  declineCircle: {
    backgroundColor: '#ef4444',
  },
  acceptCircle: {
    backgroundColor: '#22c55e',
  },
  actionIcon: {
    fontSize: 32,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  actionLabel: {
    marginTop: 10,
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
});
