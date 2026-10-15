import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { palette } from '@/constants/Colors';
import type { SyncError } from '@/src/hooks/useSchoolQuery';
import type { ErrorKind } from '@/src/librus/errors';

export function useTheme() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return Colors[scheme];
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }, style]}>
      {children}
    </View>
  );
}

export function ScreenMessage({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.centered}>
      <Text style={[styles.messageTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.messageBody, { color: theme.muted }]}>{body}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} style={[styles.action, { backgroundColor: theme.tint }]}>
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function LoadingState({ label = 'Pobieram dane…' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={theme.tint} />
      <Text style={[styles.messageBody, { color: theme.muted, marginTop: 12 }]}>{label}</Text>
    </View>
  );
}

export function GradeBadge({ value }: { value: string }) {
  const background = gradeColor(value);
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      <Text style={styles.badgeText}>{value}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: theme.tint, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}>
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

const SYNC_COPY: Partial<Record<ErrorKind, string>> = {
  offline: 'Brak internetu. Pokazuję zapisane dane.',
  timeout: 'Librus nie odpowiada. Pokazuję zapisane dane.',
  server: 'Librus ma przerwę. Pokazuję zapisane dane.',
  auth: 'Nie udało się odnowić sesji. Pokazuję zapisane dane.',
};

/** Slim, non-blocking notice shown above cached data when a refresh failed. */
export function SyncBanner({ error, onRetry }: { error: SyncError; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View
      testID="sync-banner"
      accessibilityRole="alert"
      style={[styles.sync, { backgroundColor: theme.card, borderColor: palette.amber }]}>
      <Text style={[styles.syncText, { color: theme.text }]} numberOfLines={2}>
        {SYNC_COPY[error.kind] ?? `${error.message} Pokazuję zapisane dane.`}
      </Text>
      <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button" testID="sync-retry">
        <Text style={[styles.syncAction, { color: theme.tint }]}>Odśwież</Text>
      </Pressable>
    </View>
  );
}

export function DemoBanner() {
  return (
    <View style={styles.demo}>
      <Text style={styles.demoText}>Przykładowe dane — to nie jest dziennik Twojego dziecka</Text>
    </View>
  );
}

function gradeColor(value: string): string {
  const first = value.trim()[0];
  if (first === '6' || first === '5') return palette.green;
  if (first === '4') return palette.blue;
  if (first === '3') return palette.amber;
  if (first === '2' || first === '1') return palette.red;
  return palette.muted;
}

const styles = StyleSheet.create({
  sync: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  syncText: { flex: 1, fontSize: 13, lineHeight: 18 },
  syncAction: { fontSize: 13, fontWeight: '700' },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  centered: {
    paddingHorizontal: 28,
    paddingVertical: 48,
    alignItems: 'center',
  },
  messageTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  messageBody: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  action: {
    marginTop: 18,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  actionLabel: {
    color: '#fff',
    fontWeight: '700',
  },
  badge: {
    minWidth: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  primary: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryLabel: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  demo: {
    backgroundColor: '#F6E1C8',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  demoText: {
    color: '#7A4A18',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
});
