import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { usePublicConfig } from '../config/PublicConfigContext';

interface OfflineConnectScreenProps {
  reason?: 'no_config' | 'untrusted_maintenance' | 'untrusted_version';
}

export default function OfflineConnectScreen({ reason = 'no_config' }: OfflineConnectScreenProps) {
  const { refetch } = usePublicConfig();
  const [retrying, setRetrying] = useState(false);

  const getExplanation = () => {
    switch (reason) {
      case 'untrusted_maintenance':
        return 'The app was previously in maintenance mode. An active internet connection is required to verify system availability.';
      case 'untrusted_version':
        return 'An active internet connection is required to verify supported version status.';
      case 'no_config':
      default:
        return 'Unable to establish initial connection to the platform. An active internet connection is required on first launch.';
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await refetch();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>📡</Text>
        </View>

        <Text style={styles.title}>Unable to Connect</Text>
        <Text style={styles.message}>{getExplanation()}</Text>

        <TouchableOpacity
          style={styles.button}
          onPress={handleRetry}
          disabled={retrying}
          activeOpacity={0.8}
        >
          {retrying ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.buttonText}>Retry Connection</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f1d',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 28,
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
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
    fontSize: 15,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#4f46e5',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
