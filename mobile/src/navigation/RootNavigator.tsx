import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { useAuth } from '../auth/AuthContext';
import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import OtpVerifyScreen from '../screens/OtpVerifyScreen';
import HomeScreen from '../screens/HomeScreen';
import SearchingScreen from '../screens/SearchingScreen';
import IncomingCallScreen from '../screens/IncomingCallScreen';
import InCallScreen from '../screens/InCallScreen';
import WalletScreen from '../screens/WalletScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <SplashScreen />;
  }

  return (
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
  );
}
