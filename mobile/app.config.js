module.exports = {
  expo: {
    name: 'AnonAudioCall',
    slug: 'anonaudiocall',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.hemal.anonaudiocall',
      infoPlist: {
        NSMicrophoneUsageDescription:
          'Allow Anonymous Audio Calling to access your microphone for anonymous voice calls.',
      },
      bitcode: false,
    },
    android: {
      package: 'com.hemal.anonaudiocall',
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
      permissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.CAMERA',
        'android.permission.INTERNET',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.WAKE_LOCK',
        'android.permission.BLUETOOTH',
      ],
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-secure-store',
      'expo-notifications',
      [
        '@config-plugins/react-native-webrtc',
        {
          cameraPermission: false,
          microphonePermission:
            'Allow Anonymous Audio Calling to access your microphone for anonymous audio calls.',
        },
      ],
    ],
    extra: {
      eas: {
        projectId: 'dac60703-a317-440f-a9af-96c746688654',
      },
    },
  },
};
