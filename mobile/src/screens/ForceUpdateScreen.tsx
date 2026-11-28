import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Linking,
} from 'react-native';
import { APP_VERSION } from '../config/constants';

interface ForceUpdateScreenProps {
  minVersion?: string;
  forceUpdateUrl?: string;
}

export default function ForceUpdateScreen({
  minVersion,
  forceUpdateUrl,
}: ForceUpdateScreenProps) {
  const storeUrl =
    forceUpdateUrl ||
    'https://play.google.com/store/apps/details?id=com.hemal.anonaudiocall';

  const handleUpdateNow = async () => {
    try {
      const supported = await Linking.canOpenURL(storeUrl);
      if (supported) {
        await Linking.openURL(storeUrl);
      } else {
        await Linking.openURL(storeUrl);
      }
    } catch {
      // Fallback open
      Linking.openURL(storeUrl).catch(() => {});
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>🚀</Text>
        </View>

        <Text style={styles.title}>Update Required</Text>
        <Text style={styles.message}>
          A mandatory update is required to continue using Anonymous Audio Calling.
          Your installed version is no longer supported.
        </Text>

        <View style={styles.versionBox}>
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>Installed Version:</Text>
            <Text style={styles.versionValueInstalled}>{APP_VERSION}</Text>
          </View>
          {minVersion ? (
            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>Minimum Required:</Text>
              <Text style={styles.versionValueRequired}>{minVersion}</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity style={styles.button} onPress={handleUpdateNow} activeOpacity={0.8}>
          <Text style={styles.buttonText}>Update Now</Text>
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
    fontSize: 15,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  versionBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 8,
    padding: 14,
    width: '100%',
    marginBottom: 24,
    gap: 8,
  },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  versionLabel: {
    fontSize: 13,
    color: '#64748b',
  },
  versionValueInstalled: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ef4444',
  },
  versionValueRequired: {
    fontSize: 14,
    fontWeight: '600',
    color: '#22c55e',
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
