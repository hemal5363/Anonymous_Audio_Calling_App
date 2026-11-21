import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SearchingScreenNavigationProp } from '../navigation/types';
import { useCall } from '../call/CallContext';

export default function SearchingScreen() {
  const navigation = useNavigation<SearchingScreenNavigationProp>();
  const { callStatus, cancelFind, lastEndInfo, clearEndInfo } = useCall();

  // Radar pulse animation
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.25,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [pulseAnim]);

  // Navigate when call is matched or ends (never silently return to Home)
  useEffect(() => {
    if (callStatus === 'connected') {
      navigation.replace('InCall');
    } else if (callStatus === 'ended') {
      const reason = lastEndInfo?.reason;

      let title = 'Call Ended';
      if (reason === 'no_users_available') {
        title = 'No Users Available';
      } else if (reason === 'ring_timeout' || reason === 'missed') {
        title = 'No Answer';
      } else if (reason === 'caller_left') {
        title = 'Call Cancelled';
      } else if (reason === 'disconnected' || reason === 'network_error') {
        title = 'Connection Disconnected';
      }

      const message = lastEndInfo?.friendlyMessage || 'Unable to connect to a partner right now. Please try again.';

      Alert.alert(
        title,
        message,
        [
          {
            text: 'OK',
            onPress: () => {
              clearEndInfo();
              navigation.replace('Home');
            },
          },
        ],
        { cancelable: false }
      );
    }
  }, [callStatus, lastEndInfo, navigation, clearEndInfo]);

  const handleCancel = () => {
    cancelFind();
    navigation.replace('Home');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Animated Radar Pulse */}
        <View style={styles.radarWrapper}>
          <Animated.View
            style={[
              styles.radarRingOuter,
              {
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />
          <View style={styles.radarRingInner}>
            <ActivityIndicator size="large" color="#38bdf8" />
          </View>
        </View>

        {/* Searching Status */}
        <Text style={styles.statusTitle}>
          {callStatus === 'ringing' ? 'Ringing Partner...' : 'Finding Someone Available...'}
        </Text>
        <Text style={styles.statusSubtitle}>
          {callStatus === 'ringing'
            ? 'Waiting for partner to answer the call'
            : 'Matching with an available anonymous user on the network'}
        </Text>

        {/* Privacy reassurance */}
        <View style={styles.privacyCard}>
          <Text style={styles.privacyIcon}>🔒</Text>
          <Text style={styles.privacyText}>
            100% Anonymous. Neither you nor your partner can see names, numbers, or emails.
          </Text>
        </View>

        {/* Cancel Button */}
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={handleCancel}
          activeOpacity={0.75}
        >
          <Text style={styles.cancelButtonText}>Cancel Search</Text>
        </TouchableOpacity>
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  radarWrapper: {
    width: 180,
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
  },
  radarRingOuter: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
    borderWidth: 2,
    borderColor: '#38bdf8',
  },
  radarRingInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#1e293b',
    borderWidth: 3,
    borderColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
  },
  statusTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
    textAlign: 'center',
    marginBottom: 10,
  },
  statusSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 20,
    marginBottom: 36,
  },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131b2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    maxWidth: 320,
    marginBottom: 48,
  },
  privacyIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  privacyText: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 36,
  },
  cancelButtonText: {
    color: '#ef4444',
    fontSize: 15,
    fontWeight: '700',
  },
});
