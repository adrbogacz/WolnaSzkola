import { useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';

import { useAuth } from '@/src/auth/AuthContext';
import { formatDate } from '@/src/format';
import { useSchoolQuery } from '@/src/hooks/useSchoolQuery';
import type { SchoolAttendance } from '@/src/librus/types';
import { Card, DemoBanner, LoadingState, ScreenMessage, useTheme } from '@/src/ui';

export default function AttendanceScreen() {
  const { status, isDemo, api } = useAuth();
  const theme = useTheme();
  const query = useSchoolQuery(() => api.getAttendance(), [api]);
  const [hidePresence, setHidePresence] = useState(true);

  if (status !== 'ready') return <Redirect href="/" />;
  const items = [...(query.data ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.lessonNo - a.lessonNo);
  const absences = items.filter((item) => !item.isPresence);
  const lates = items.filter((item) => item.isPresence && /spóź/i.test(item.typeName));
  const visible = hidePresence ? items.filter((item) => !item.isPresence || /spóź/i.test(item.typeName)) : items;
  const sections = groupByDate(visible);

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      {isDemo ? <DemoBanner /> : null}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshing={query.refreshing}
        onRefresh={() => void query.reload(true)}
        ListHeaderComponent={
          items.length > 0 ? (
            <View>
              <View style={styles.summary}>
                <SummaryChip label="Nieobecności" value={String(absences.length)} />
                <SummaryChip label="Spóźnienia" value={String(lates.length)} />
                <SummaryChip label="Wpisy" value={String(items.length)} />
              </View>
              <Pressable
                onPress={() => setHidePresence((value) => !value)}
                style={[styles.filter, { backgroundColor: hidePresence ? theme.tint : theme.card, borderColor: theme.line }]}
                accessibilityRole="button"
                accessibilityState={{ selected: hidePresence }}>
                <Text style={[styles.filterLabel, { color: hidePresence ? '#fff' : theme.text }]}>
                  {hidePresence ? 'Pokaż obecności' : 'Ukryj obecności'}
                </Text>
              </Pressable>
            </View>
          ) : null
        }
        ListEmptyComponent={
          query.loading ? (
            <LoadingState label="Pobieram frekwencję…" />
          ) : query.error ? (
            <ScreenMessage
              title="Nie udało się wczytać frekwencji"
              body={query.error}
              actionLabel="Spróbuj ponownie"
              onAction={() => void query.reload()}
            />
          ) : visible.length === 0 && items.length > 0 ? (
            <ScreenMessage
              title="Same obecności"
              body="Nie ma nieobecności ani spóźnień. Włącz obecności, żeby zobaczyć pełną listę."
            />
          ) : (
            <ScreenMessage title="Brak wpisów" body="Frekwencja z dziennika pojawi się tutaj." />
          )
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.day, { color: theme.text }]}>{formatDate(section.title)}</Text>
        )}
        renderItem={({ item }) => <AttendanceRow item={item} />}
      />
    </View>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <Card style={styles.chip}>
      <Text style={[styles.chipValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.chipLabel, { color: theme.muted }]}>{label}</Text>
    </Card>
  );
}

function AttendanceRow({ item }: { item: SchoolAttendance }) {
  const theme = useTheme();
  return (
    <Card style={styles.row}>
      <View style={[styles.mark, { backgroundColor: item.color }]}>
        <Text style={styles.markText}>{item.typeShort}</Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.type, { color: theme.text }]}>{item.typeName}</Text>
        <Text style={[styles.meta, { color: theme.muted }]}>
          lekcja {item.lessonNo}
          {item.subject ? ` · ${item.subject}` : ''}
        </Text>
      </View>
    </Card>
  );
}

function groupByDate(items: SchoolAttendance[]) {
  const map = new Map<string, SchoolAttendance[]>();
  for (const item of items) {
    const list = map.get(item.date) ?? [];
    list.push(item);
    map.set(item.date, list);
  }
  return [...map.entries()].map(([title, data]) => ({ title, data }));
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 16, paddingBottom: 40 },
  summary: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  filter: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginBottom: 8 },
  filterLabel: { fontSize: 14, fontWeight: '700' },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  chipValue: { fontSize: 22, fontWeight: '800' },
  chipLabel: { marginTop: 2, fontSize: 12, textAlign: 'center' },
  day: { fontSize: 16, fontWeight: '800', marginTop: 12, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 8 },
  mark: {
    minWidth: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  markText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  body: { flex: 1 },
  type: { fontSize: 16, fontWeight: '700' },
  meta: { marginTop: 4, fontSize: 13 },
});
