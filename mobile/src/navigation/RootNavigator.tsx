import React from 'react';
import { View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { useAuth } from '../auth/AuthContext';
import { usePublicConfig } from '../config/PublicConfigContext';
import { useCall } from '../call/CallContext';
import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import OtpVerifyScreen from '../screens/OtpVerifyScreen';
import HomeScreen from '../screens/HomeScreen';
import SearchingScreen from '../screens/SearchingScreen';
import IncomingCallScreen from '../screens/IncomingCallScreen';
import InCallScreen from '../screens/InCallScreen';
import WalletScreen from '../screens/WalletScreen';
import SettingsScreen from '../screens/SettingsScreen';
import MaintenanceScreen from '../screens/MaintenanceScreen';
import ForceUpdateScreen from '../screens/ForceUpdateScreen';
import OfflineConnectScreen from '../screens/OfflineConnectScreen';
import ConsentScreen from '../screens/ConsentScreen';
import OfflineBanner from '../components/OfflineBanner';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { isLoading: isConfigLoading, gatingState, isOffline, hasSavedCopy } = usePublicConfig();
  const { callStatus } = useCall();

  // Show splash until first config result (max 5s timeout) or auth load
  if (isConfigLoading || isAuthLoading) {
    return <SplashScreen />;
  }

  // An active call already connected is NOT interrupted by maintenance or update gating
  const isInActiveCall = callStatus === 'connected';

  if (!isInActiveCall) {
    if (gatingState.status === 'maintenance') {
      return <MaintenanceScreen message={gatingState.message} />;
    }
    if (gatingState.status === 'update_required') {
      return (
        <ForceUpdateScreen
          minVersion={gatingState.minVersion}
          forceUpdateUrl={gatingState.forceUpdateUrl}
        />
      );
    }
    if (gatingState.status === 'offline_blocked') {
      return <OfflineConnectScreen reason={gatingState.reason} />;
    }
    if (gatingState.status === 'consent_required') {
      return (
        <ConsentScreen
          termsVersion={gatingState.termsVersion}
          privacyVersion={gatingState.privacyVersion}
        />
      );
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0f1d' }}>
      <OfflineBanner visible={isOffline && hasSavedCopy} />
      <Stack.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: '#0a0f1d',
          },
          headerTintColor: '#f8fafc',
          headerTitleStyle: {
            fontWeight: '600',
          },
          contentStyle: {
            backgroundColor: '#0a0f1d',
          },
        }}
      >
      {isAuthenticated ? (
        <>
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Searching"
            component={SearchingScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="IncomingCall"
            component={IncomingCallScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="InCall"
            component={InCallScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Wallet"
            component={WalletScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{
              title: 'Settings & Account',
              headerBackTitle: 'Home',
            }}
          />
        </>
      ) : (
        <>
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Register"
            component={RegisterScreen}
            options={{
              title: 'Create Account',
              headerBackTitle: 'Login',
            }}
          />
          <Stack.Screen
            name="OtpVerify"
            component={OtpVerifyScreen}
            options={{
              title: 'Verify Phone',
              headerBackTitle: 'Back',
            }}
          />
        </>
      )}
    </Stack.Navigator>
  </View>
  );
}
