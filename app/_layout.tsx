import 'react-native-gesture-handler';
import '@/src/background/notifications';
import '@/src/background/syncTask';

import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from '@/src/auth/AuthContext';
import { subscribeNotificationNavigation } from '@/src/background/notifications';
import { useTheme } from '@/src/ui';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <RootNavigation />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigation() {
  const { status } = useAuth();
  const theme = useTheme();

  useEffect(() => {
    return subscribeNotificationNavigation(() => {
      router.push('/(tabs)/messages');
    });
  }, []);

  if (status === 'booting') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.tint} />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerTintColor: theme.tint,
          headerStyle: { backgroundColor: theme.background },
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: theme.background },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="select-child" options={{ title: 'Wybierz dziecko', headerBackVisible: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="message/[id]" options={{ title: 'Wiadomość' }} />
        <Stack.Screen
          name="compose"
          options={{ title: 'Nowa wiadomość', presentation: 'modal' }}
        />
        <Stack.Screen name="settings" options={{ title: 'Ustawienia' }} />
      </Stack>
    </>
  );
}
