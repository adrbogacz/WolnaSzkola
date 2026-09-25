import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SUPPORT_EMAIL } from '@/src/appSettings';

import { useAuth } from '@/src/auth/AuthContext';
import { messageFromUnknown } from '@/src/librus/errors';
import { getLoginLog } from '@/src/librus/loginLog';
import { PrimaryButton, useTheme } from '@/src/ui';

export default function LoginScreen() {
  const { status, accounts, switchAccount, login, enterDemo } = useAuth();
  const params = useLocalSearchParams<{ add?: string }>();
  const adding = params.add === '1';
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string | null>(null);
  const lastTap = useRef(0);

  if (!adding && status === 'selectChild') return <Redirect href="/select-child" />;
  if (!adding && status === 'ready') return <Redirect href="/(tabs)/messages" />;

  async function onSubmit() {
    const now = Date.now();
    if (now - lastTap.current < 300) return;
    lastTap.current = now;
    if (busy || !email.trim() || !password) return;

    setError(null);
    setDebug(null);
    setBusy(true);
    try {
      await login(email, password);
      if (adding) router.replace('/(tabs)/messages');
    } catch (caught) {
      const log = getLoginLog();
      setError(messageFromUnknown(caught));
      setDebug(log || String(caught));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = Boolean(email.trim() && password) && !busy;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {accounts.length > 0 ? (
            <View style={styles.savedAccounts}>
              <Text style={[styles.label, { color: theme.text }]}>Zapisane konta</Text>
              {accounts.map((account) => (
                <Pressable
                  key={account.id}
                  onPress={() => {
                    void switchAccount(account.id)
                      .then(() => router.replace('/(tabs)/messages'))
                      .catch(() => undefined);
                  }}
                  style={[styles.savedAccount, { borderColor: theme.line, backgroundColor: theme.card }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Przełącz na ${account.label}`}>
                  <Text style={[styles.savedLabel, { color: theme.text }]}>{account.label}</Text>
                  <Text style={[styles.hint, { color: theme.muted }]}>Login {account.login}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={[styles.kicker, { color: theme.accent }]}>Dla rodziców klasy</Text>
          <Text style={[styles.title, { color: theme.text }]}>WolnaSzkoła</Text>
          <Text style={[styles.lead, { color: theme.muted }]}>
            Wiadomości, oceny, frekwencja i plan zajęć z dziennika — bez opłat za aplikację.
            Hasło zostaje na telefonie.
          </Text>

          <Text style={[styles.label, { color: theme.text }]}>Login z dziennika</Text>
          <Text style={[styles.hint, { color: theme.muted }]}>
            Same cyfry, jak w aplikacji Librus. Nie e-mail z Gmaila.
          </Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            spellCheck={false}
            keyboardType="number-pad"
            textContentType="none"
            importantForAutofill="no"
            placeholder="Login z dziennika"
            placeholderTextColor={theme.muted}
            style={[styles.input, { color: theme.text, backgroundColor: theme.card, borderColor: theme.line }]}
            value={email}
            onChangeText={setEmail}
          />

          <Text style={[styles.label, { color: theme.text }]}>Hasło z dziennika</Text>
          <View style={styles.passwordRow}>
            <TextInput
              autoCapitalize="none"
              autoComplete="off"
              textContentType="none"
              importantForAutofill="no"
              placeholder={
                Platform.OS === 'ios'
                  ? 'Hasło z aplikacji Librus, nie z iCloud'
                  : 'Hasło z aplikacji Librus, nie z Google'
              }
              placeholderTextColor={theme.muted}
              secureTextEntry={hidden}
              style={[
                styles.input,
                styles.passwordInput,
                { color: theme.text, backgroundColor: theme.card, borderColor: theme.line },
              ]}
              value={password}
              onChangeText={setPassword}
            />
            <Pressable
              onPress={() => setHidden((value) => !value)}
              style={styles.eye}
              accessibilityRole="button"
              accessibilityLabel={hidden ? 'Pokaż hasło' : 'Ukryj hasło'}>
              <Text style={{ color: theme.tint, fontWeight: '600' }}>{hidden ? 'Pokaż' : 'Ukryj'}</Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {debug ? (
            <View style={[styles.debugBox, { borderColor: theme.line, backgroundColor: theme.card }]}>
              <Text style={[styles.debugTitle, { color: theme.text }]}>Co pokazać przy pomocy</Text>
              <Text style={[styles.debugHint, { color: theme.muted }]}>
                Wyślij ten opis na {SUPPORT_EMAIL}. Nie dopisuj hasła.
              </Text>
              <Text selectable style={[styles.debugText, { color: theme.text }]}>
                {debug}
              </Text>
              <Pressable
                onPress={() => void Share.share({ message: debug, title: 'WolnaSzkoła logi' })}
                accessibilityRole="button"
                accessibilityLabel="Wyślij opis do pomocy">
                <Text style={[styles.debugShare, { color: theme.tint }]}>Wyślij ten opis</Text>
              </Pressable>
            </View>
          ) : null}

          <PrimaryButton
            label={busy ? 'Loguję…' : 'Zaloguj'}
            onPress={() => void onSubmit()}
            disabled={!canSubmit}
          />

          {Platform.OS === 'web' ? (
            <Text style={[styles.note, { color: theme.muted }]}>
              W przeglądarce hasło nie jest tak dobrze chronione jak na telefonie. Do codziennego użytku lepiej
              zainstalować aplikację na Androidzie.
            </Text>
          ) : (
            <Text style={[styles.note, { color: theme.muted }]}>
              To nieoficjalna, darmowa aplikacja. Wpisz ręcznie login i hasło z dziennika — te same, którymi
              wchodzisz do aplikacji Librus. Hasło z konta Google albo iCloud tu nie wejdzie.
            </Text>
          )}

          <Pressable
            onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
            style={styles.demoLink}
            accessibilityRole="link"
            accessibilityLabel="Napisz do pomocy">
            <Text style={[styles.demoText, { color: theme.muted }]}>Pomoc: {SUPPORT_EMAIL}</Text>
          </Pressable>

          <View style={styles.orRow}>
            <View style={[styles.orLine, { backgroundColor: theme.line }]} />
            <Text style={[styles.orText, { color: theme.muted }]}>albo</Text>
            <View style={[styles.orLine, { backgroundColor: theme.line }]} />
          </View>

          <Pressable
            onPress={enterDemo}
            style={styles.demoLink}
            accessibilityRole="button"
            accessibilityLabel="Zobacz przykładowy wygląd">
            <Text style={[styles.demoText, { color: theme.muted }]}>Zobacz przykładowy wygląd</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: 24, paddingTop: 36, paddingBottom: 48 },
  kicker: { fontSize: 14, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { fontSize: 40, fontWeight: '800', marginTop: 8, letterSpacing: -0.8 },
  lead: { fontSize: 17, lineHeight: 24, marginTop: 12, marginBottom: 28 },
  label: { fontSize: 15, fontWeight: '600', marginBottom: 8 },
  hint: { fontSize: 13, lineHeight: 18, marginTop: -4, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    marginBottom: 16,
  },
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 72 },
  eye: { position: 'absolute', right: 16, top: 16 },
  error: { color: '#B42318', fontSize: 15, marginBottom: 16, lineHeight: 20 },
  debugBox: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 16 },
  debugTitle: { fontSize: 14, fontWeight: '700', marginBottom: 6 },
  debugHint: { fontSize: 12, lineHeight: 16, marginBottom: 8 },
  debugText: { fontSize: 11, lineHeight: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  debugShare: { marginTop: 12, fontSize: 15, fontWeight: '700' },
  note: { marginTop: 18, fontSize: 14, lineHeight: 20 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 28 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth },
  orText: { fontSize: 13, fontWeight: '600' },
  savedAccounts: { marginBottom: 24, gap: 8 },
  savedAccount: { borderWidth: 1, borderRadius: 16, padding: 14 },
  savedLabel: { fontSize: 17, fontWeight: '700' },
  demoLink: { marginTop: 16, alignItems: 'center', paddingVertical: 8 },
  demoText: { fontSize: 15, fontWeight: '600' },
});
