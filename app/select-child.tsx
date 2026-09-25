import { Pressable, StyleSheet, Text } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth/AuthContext';
import { Card, useTheme } from '@/src/ui';

export default function SelectChildScreen() {
  const { status, children, selectChild, logout } = useAuth();
  const theme = useTheme();

  if (status === 'loggedOut') return <Redirect href="/login" />;
  if (status === 'ready') return <Redirect href="/(tabs)/messages" />;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['bottom']}>
      <Text style={[styles.lead, { color: theme.muted }]}>
        Na koncie jest kilka dzieci. Wybierz, które chcesz teraz oglądać.
      </Text>
      {children.map((child) => (
        <Pressable key={child.id} onPress={() => void selectChild(child)} style={styles.item}>
          <Card>
            <Text style={[styles.name, { color: theme.text }]}>{child.studentName}</Text>
            <Text style={[styles.login, { color: theme.muted }]}>{child.login}</Text>
          </Card>
        </Pressable>
      ))}
      <Pressable onPress={() => void logout()} style={styles.logout}>
        <Text style={{ color: theme.accent, fontWeight: '700' }}>Wyloguj</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, padding: 20 },
  lead: { fontSize: 16, lineHeight: 22, marginBottom: 16 },
  item: { marginBottom: 12 },
  name: { fontSize: 20, fontWeight: '700' },
  login: { marginTop: 4, fontSize: 14 },
  logout: { alignItems: 'center', marginTop: 24, padding: 12 },
});
