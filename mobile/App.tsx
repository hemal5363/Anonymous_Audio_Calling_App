import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PublicConfigProvider } from './src/config/PublicConfigContext';
import { AuthProvider } from './src/auth/AuthContext';
import { CallProvider } from './src/call/CallContext';
import RootNavigator from './src/navigation/RootNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <PublicConfigProvider>
        <AuthProvider>
          <CallProvider>
            <NavigationContainer>
              <RootNavigator />
              <StatusBar style="light" />
            </NavigationContainer>
          </CallProvider>
        </AuthProvider>
      </PublicConfigProvider>
    </SafeAreaProvider>
  );
}
