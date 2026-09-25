import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Redirect, router } from 'expo-router';

import { REGULAMIN_WARNING, SUPPORT_EMAIL, SYNC_INTERVAL_OPTIONS } from '@/src/appSettings';
import { useAuth } from '@/src/auth/AuthContext';
import { Card, PrimaryButton, useTheme } from '@/src/ui';

function appVersionLabel(): string {
  const version = Constants.expoConfig?.version?.trim();
  const code = Constants.expoConfig?.android?.versionCode;
  if (version && code) return `${version} (${code})`;
  return version || 'nieznana';
}

export default function SettingsScreen() {
  const {
    status,
    isDemo,
    accounts,
    accountId,
    switchAccount,
    logout,
    showArchived,
    setShowArchived,
    syncIntervalMinutes,
    setSyncIntervalMinutes,
    clearLocalAppData,
  } = useAuth();
  const theme = useTheme();

  if (status !== 'ready') return <Redirect href="/" />;

  function confirmLogout() {
    Alert.alert(
      'Wylogować to konto?',
      'Hasło tego konta zniknie z telefonu. Pozostałe konta zostaną.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Wyloguj to konto',
          style: 'destructive',
          onPress: () => {
            void logout().then(() => router.replace('/login'));
          },
        },
      ],
    );
  }

  function confirmClearLocal() {
    Alert.alert(
      'Usunąć lokalne dane apki?',
      'Znikną oznaczenia przeczytanych oraz ukryte i zarchiwizowane wiadomości na tym telefonie.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: () => {
            void clearLocalAppData();
          },
        },
      ],
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.section, { color: theme.muted }]}>Aplikacja</Text>
      <Card style={styles.rowCard}>
        <Text style={[styles.rowTitle, { color: theme.text }]}>WolnaSzkoła</Text>
        <Text style={[styles.rowHint, { color: theme.muted }]}>Wersja {appVersionLabel()}</Text>
      </Card>

      <Text style={[styles.section, { color: theme.muted }]}>Wiadomości</Text>
      <Card style={styles.rowCard}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: theme.text }]}>Pokaż zarchiwizowane</Text>
            <Text style={[styles.rowHint, { color: theme.muted }]}>
              Usunięte wiadomości zostają ukryte. Zarchiwizowane widać tylko, gdy włączysz tę opcję.
            </Text>
          </View>
          <Switch value={showArchived} onValueChange={setShowArchived} />
        </View>
      </Card>

      <Text style={[styles.section, { color: theme.muted }]}>Odświeżanie w tle</Text>
      <View style={styles.chips}>
        {SYNC_INTERVAL_OPTIONS.map((option) => {
          const active = syncIntervalMinutes === option.minutes;
          return (
            <Pressable
              key={option.minutes}
              onPress={() => void setSyncIntervalMinutes(option.minutes)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? theme.tint : theme.card,
                  borderColor: active ? theme.tint : theme.line,
                },
              ]}>
              <Text style={[styles.chipLabel, { color: active ? '#fff' : theme.text }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {syncIntervalMinutes > 0 && syncIntervalMinutes < 15 ? (
        <Text style={styles.warning}>{REGULAMIN_WARNING}</Text>
      ) : null}
      <Text style={[styles.note, { color: theme.muted }]}>
        Telefon sam wybiera, kiedy sprawdzić skrzynkę. Może to być później, niż ustawisz.
      </Text>
      {isDemo ? (
        <Text style={[styles.note, { color: theme.muted }]}>
          Przykładowy wygląd nie łączy się z dziennikiem, więc nic nie pobierze w tle.
        </Text>
      ) : null}

      {Platform.OS === 'web' ? (
        <>
          <Text style={[styles.section, { color: theme.muted }]}>Przeglądarka</Text>
          <Text style={[styles.note, { color: theme.muted }]}>
            W przeglądarce hasło nie jest tak dobrze chronione jak na telefonie. Do codziennego użytku lepiej
            zainstalować aplikację na Androidzie.
          </Text>
        </>
      ) : null}

      <Text style={[styles.section, { color: theme.muted }]}>Pomoc</Text>
      <Text style={[styles.note, { color: theme.muted }]}>
        Pytania i problemy: napisz na {SUPPORT_EMAIL}. Nie wysyłaj hasła.
      </Text>
      <Pressable
        onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        accessibilityRole="link"
        accessibilityLabel="Napisz do pomocy">
        <Text style={[styles.mailLink, { color: theme.tint }]}>Napisz do nas</Text>
      </Pressable>

      <Text style={[styles.section, { color: theme.muted }]}>Konta</Text>
      {accounts.map((account) => {
        const active = account.id === accountId;
        return (
          <Pressable
            key={account.id}
            onPress={() => {
              if (!active) void switchAccount(account.id);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}>
            <Card style={styles.rowCard}>
              <Text style={[styles.rowTitle, { color: theme.text }]}>
                {account.label}
                {active ? ' ✓' : ''}
              </Text>
              <Text style={[styles.rowHint, { color: theme.muted }]}>Login {account.login}</Text>
            </Card>
          </Pressable>
        );
      })}
      <PrimaryButton label="Dodaj konto" onPress={() => router.push({ pathname: '/login', params: { add: '1' } })} />
      <PrimaryButton label="Wyloguj to konto" onPress={confirmLogout} />
      <Pressable
        onPress={confirmClearLocal}
        style={styles.dangerLink}
        accessibilityRole="button"
        accessibilityLabel="Usuń lokalne dane apki">
        <Text style={styles.dangerText}>Usuń lokalne dane apki</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48, gap: 12 },
  section: { fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 12 },
  rowCard: { paddingVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, flexShrink: 1 },
  rowTitle: { fontSize: 16, fontWeight: '700' },
  rowHint: { marginTop: 4, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  chipLabel: { fontSize: 14, fontWeight: '700' },
  warning: { color: '#B42318', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  note: { fontSize: 13, lineHeight: 18 },
  mailLink: { fontSize: 16, fontWeight: '700', paddingVertical: 4 },
  dangerLink: { alignItems: 'center', paddingVertical: 12 },
  dangerText: { color: '#B42318', fontSize: 15, fontWeight: '700' },
});
