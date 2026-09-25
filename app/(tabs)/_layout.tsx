import { type ComponentProps } from 'react';
import { Alert, Platform, Pressable, Text, View, type ColorValue } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { Tabs, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth/AuthContext';
import { useTheme } from '@/src/ui';

type MaterialName = ComponentProps<typeof MaterialIcons>['name'];
type SfName = ComponentProps<typeof SymbolView>['name'];

function AppIcon({
  ios,
  android,
  color,
  size = 22,
}: {
  ios: Extract<SfName, string>;
  android: MaterialName;
  color: ColorValue;
  size?: number;
}) {
  if (Platform.OS === 'ios') {
    return <SymbolView name={ios} size={size} tintColor={color} resizeMode="scaleAspectFit" />;
  }
  return (
    <MaterialIcons
      name={android}
      size={size}
      color={typeof color === 'string' ? color : String(color)}
      allowFontScaling={false}
    />
  );
}

function SettingsButton() {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => router.push('/settings')}
      style={{ padding: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Ustawienia">
      <AppIcon ios="gearshape" android="settings" color={theme.muted} />
    </Pressable>
  );
}

function AccountTitle() {
  const theme = useTheme();
  const { accounts, accountId, child, switchAccount } = useAuth();
  const label = child?.studentName || accounts.find((account) => account.id === accountId)?.label || 'Wiadomości';

  function openSwitcher() {
    if (accounts.length < 2) return;
    Alert.alert('Konto', undefined, [
      ...accounts.map((account) => ({
        text: account.id === accountId ? `${account.label} ✓` : account.label,
        onPress: () => {
          if (account.id !== accountId) void switchAccount(account.id);
        },
      })),
      { text: 'Dodaj konto', onPress: () => router.push({ pathname: '/login', params: { add: '1' } }) },
      { text: 'Anuluj', style: 'cancel' as const },
    ]);
  }

  return (
    <Pressable onPress={openSwitcher} disabled={accounts.length < 2} accessibilityRole="button" accessibilityLabel="Zmień konto">
      <Text style={{ color: theme.text, fontWeight: '700', fontSize: 17 }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function TabLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.tabIconDefault,
        tabBarAllowFontScaling: false,
        tabBarStyle: {
          backgroundColor: theme.card,
          borderTopColor: theme.line,
        },
        tabBarItemStyle: {
          paddingBottom: insets.bottom > 0 ? 0 : 4,
        },
        headerStyle: { backgroundColor: theme.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '700' },
        headerTintColor: theme.text,
        headerRight: () => (
          <View style={{ marginRight: 8 }}>
            <SettingsButton />
          </View>
        ),
      }}>
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Wiadomości',
          headerTitle: () => <AccountTitle />,
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
              <Pressable
                onPress={() => router.push('/compose')}
                style={{ padding: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Nowa wiadomość">
                <AppIcon ios="square.and.pencil" android="edit" color={theme.tint} />
              </Pressable>
              <SettingsButton />
            </View>
          ),
          tabBarIcon: ({ color, size }) => (
            <AppIcon ios="envelope.fill" android="mail" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="grades"
        options={{
          title: 'Oceny',
          tabBarIcon: ({ color, size }) => (
            <AppIcon ios="chart.bar.fill" android="bar-chart" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Frekwencja',
          tabBarIcon: ({ color, size }) => (
            <AppIcon ios="checkmark.circle.fill" android="check-circle" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Plan',
          headerTitle: 'Plan zajęć',
          tabBarIcon: ({ color, size }) => (
            <AppIcon ios="calendar" android="calendar-month" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
