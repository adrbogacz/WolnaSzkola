import { SectionList, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';

import { useAuth } from '@/src/auth/AuthContext';
import { formatAverage, formatDate, gradeToNumber } from '@/src/format';
import { useSchoolQuery } from '@/src/hooks/useSchoolQuery';
import type { SchoolGrade } from '@/src/librus/types';
import { Card, DemoBanner, GradeBadge, LoadingState, ScreenMessage, useTheme } from '@/src/ui';

export default function GradesScreen() {
  const { status, isDemo, api } = useAuth();
  const theme = useTheme();
  const query = useSchoolQuery(() => api.getGrades(), [api]);

  if (status !== 'ready') return <Redirect href="/" />;

  const sections = groupBySubject(query.data ?? []);

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
        ListEmptyComponent={
          query.loading ? (
            <LoadingState label="Pobieram oceny…" />
          ) : query.error ? (
            <ScreenMessage
              title="Nie udało się wczytać ocen"
              body={query.error}
              actionLabel="Spróbuj ponownie"
              onAction={() => void query.reload()}
            />
          ) : (
            <ScreenMessage title="Brak ocen" body="Jak tylko pojawią się w dzienniku, zobaczysz je tutaj." />
          )
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={[styles.subject, { color: theme.text }]}>{section.title}</Text>
            {section.average ? (
              <Text style={[styles.average, { color: theme.muted }]}>śr. {section.average}</Text>
            ) : null}
          </View>
        )}
        renderItem={({ item }) => <GradeRow grade={item} />}
      />
    </View>
  );
}

function GradeRow({ grade }: { grade: SchoolGrade }) {
  const theme = useTheme();
  const descriptive = grade.value === 'opis' || grade.value.length > 5;
  const formative = Boolean(grade.isFormative);
  const flags = [
    grade.isFinal ? 'końcowa' : null,
    grade.isSemester ? 'semestr' : null,
    grade.isProposition ? 'propozycja' : null,
    formative ? 'kształtująca' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card style={styles.gradeCard}>
      <GradeBadge value={descriptive ? 'opis' : grade.value} />
      <View style={styles.gradeBody}>
        <Text style={[styles.category, { color: theme.text }]}>{grade.category}</Text>
        <Text style={[styles.meta, { color: theme.muted }]}>
          {formatDate(grade.date)}
          {grade.teacher ? ` · ${grade.teacher}` : ''}
        </Text>
        {flags ? <Text style={[styles.flag, { color: theme.accent }]}>{flags}</Text> : null}
        {descriptive && grade.value !== 'opis' ? (
          <Text style={[styles.comment, { color: theme.text }]}>{grade.value}</Text>
        ) : null}
        {grade.comment ? <Text style={[styles.comment, { color: theme.muted }]}>{grade.comment}</Text> : null}
      </View>
    </Card>
  );
}

function groupBySubject(grades: SchoolGrade[]) {
  const map = new Map<string, SchoolGrade[]>();
  for (const grade of [...grades].sort((a, b) => b.date.localeCompare(a.date))) {
    if (/^(przedmiot|ocena)$/i.test(grade.subject.trim()) && /^(przedmiot|ocena)?$/i.test(grade.category.trim())) {
      continue;
    }
    const key = grade.subject || 'Inne';
    const list = map.get(key) ?? [];
    list.push(grade);
    map.set(key, list);
  }

  return [...map.entries()].map(([title, data]) => {
    const numeric = data
      .filter(
        (grade) =>
          !grade.isFinal &&
          !grade.isSemester &&
          !grade.isProposition &&
          !grade.isFormative,
      )
      .map((grade) => gradeToNumber(grade.value))
      .filter((value): value is number => value !== null);
    return { title, data, average: numeric.length >= 2 ? formatAverage(numeric) : null };
  });
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 16, paddingBottom: 40 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 12,
    marginBottom: 8,
  },
  subject: { fontSize: 20, fontWeight: '800' },
  average: { fontSize: 15, fontWeight: '600' },
  gradeCard: { flexDirection: 'row', gap: 12, marginBottom: 10, alignItems: 'center' },
  gradeBody: { flex: 1 },
  category: { fontSize: 16, fontWeight: '700' },
  meta: { marginTop: 4, fontSize: 13 },
  flag: { marginTop: 4, fontSize: 13, fontWeight: '600' },
  comment: { marginTop: 6, fontSize: 14, lineHeight: 20 },
});
