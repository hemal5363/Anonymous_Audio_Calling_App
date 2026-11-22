import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  OtpVerify: { phone: string };
  Home: undefined;
  Searching: undefined;
  IncomingCall: undefined;
  InCall: undefined;
  Wallet: undefined;
  Settings: undefined;
};

export type LoginScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Login'>;
export type RegisterScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Register'>;
export type OtpVerifyScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'OtpVerify'>;
export type OtpVerifyScreenRouteProp = RouteProp<RootStackParamList, 'OtpVerify'>;
export type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;
export type SearchingScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Searching'>;
export type IncomingCallScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'IncomingCall'>;
export type InCallScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'InCall'>;
export type WalletScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Wallet'>;
export type SettingsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Settings'>;
