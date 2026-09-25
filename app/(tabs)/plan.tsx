import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';

import { useAuth } from '@/src/auth/AuthContext';
import { addDays, formatDayHeading, isoDate, mondayOf } from '@/src/format';
import { useSchoolQuery } from '@/src/hooks/useSchoolQuery';
import type { SchoolDayPlan, SchoolLesson } from '@/src/librus/types';
import { Card, DemoBanner, LoadingState, ScreenMessage, useTheme } from '@/src/ui';

export default function PlanScreen() {
  const { status, isDemo, api } = useAuth();
  const theme = useTheme();
  const [weekStart, setWeekStart] = useState(() => isoDate(mondayOf()));
  const query = useSchoolQuery(() => api.getTimetable(weekStart), [api, weekStart]);
  const weekLabel = useMemo(() => {
    const start = new Date(`${weekStart}T12:00:00`);
    const end = addDays(start, 4);
    return `${start.getDate()}.${start.getMonth() + 1} – ${end.getDate()}.${end.getMonth() + 1}.${end.getFullYear()}`;
  }, [weekStart]);

  if (status !== 'ready') return <Redirect href="/" />;

  const days = query.data ?? [];

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      {isDemo ? <DemoBanner /> : null}
      <View style={styles.weekBar}>
        <Pressable
          onPress={() => setWeekStart(isoDate(addDays(new Date(`${weekStart}T12:00:00`), -7)))}
          style={styles.weekButton}
          accessibilityRole="button"
          accessibilityLabel="Poprzedni tydzień">
          <Text style={[styles.weekButtonText, { color: theme.tint }]}>Poprzedni</Text>
        </Pressable>
        <Text style={[styles.weekLabel, { color: theme.text }]}>{weekLabel}</Text>
        <Pressable
          onPress={() => setWeekStart(isoDate(addDays(new Date(`${weekStart}T12:00:00`), 7)))}
          style={styles.weekButton}
          accessibilityRole="button"
          accessibilityLabel="Następny tydzień">
          <Text style={[styles.weekButtonText, { color: theme.tint }]}>Następny</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={query.refreshing} onRefresh={() => void query.reload(true)} />
        }>
        {query.loading && !query.data ? (
          <LoadingState label="Pobieram plan…" />
        ) : query.error ? (
          <ScreenMessage
            title="Nie udało się wczytać planu"
            body={query.error}
            actionLabel="Spróbuj ponownie"
            onAction={() => void query.reload()}
          />
        ) : days.length === 0 ? (
          <ScreenMessage title="Brak lekcji" body="W tym tygodniu dziennik nie pokazuje zajęć." />
        ) : (
          days.map((day) => <DayBlock key={day.date} day={day} />)
        )}
      </ScrollView>
    </View>
  );
}

function DayBlock({ day }: { day: SchoolDayPlan }) {
  const theme = useTheme();
  return (
    <View style={styles.dayBlock}>
      <View style={styles.dayHeader}>
        <Text style={[styles.dayTitle, { color: theme.text }]}>{formatDayHeading(day.date)}</Text>
        {day.free ? (
          <View style={[styles.freeBadge, { backgroundColor: theme.accent }]}>
            <Text style={styles.freeBadgeText}>wolne</Text>
          </View>
        ) : null}
      </View>
      {day.freeLabel ? (
        <Card style={[styles.freeCard, day.free ? { borderColor: theme.accent } : null]}>
          <Text style={[styles.freeTitle, { color: day.free ? theme.accent : theme.muted }]}>
            {day.free ? 'Dzień wolny' : 'W dzienniku'}
          </Text>
          <Text style={[styles.freeName, { color: theme.text }]}>{day.freeLabel}</Text>
        </Card>
      ) : null}
      {(day.notes ?? [])
        .filter((note) => note !== day.freeLabel)
        .map((note) => (
          <Card key={note} style={styles.noteCard}>
            <Text style={[styles.noteText, { color: theme.text }]}>{note}</Text>
          </Card>
        ))}
      {day.lessons.map((lesson) => (
        <LessonRow key={lesson.id} lesson={lesson} />
      ))}
    </View>
  );
}

function LessonRow({ lesson }: { lesson: SchoolLesson }) {
  const theme = useTheme();
  return (
    <Card
      style={[
        styles.lesson,
        lesson.cancelled ? { opacity: 0.55 } : null,
        lesson.substitution ? { borderColor: theme.accent } : null,
      ]}>
      <Text style={[styles.hours, { color: theme.muted }]}>
        {lesson.hourFrom && lesson.hourTo ? `${lesson.hourFrom}–${lesson.hourTo}` : ' '}
      </Text>
      <View style={styles.lessonBody}>
        <Text style={[styles.subject, { color: theme.text }]}>{lesson.subject}</Text>
        <Text style={[styles.meta, { color: theme.muted }]}>
          {[lesson.teacher, lesson.classroom ? `sala ${lesson.classroom}` : '']
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {lesson.cancelled ? <Text style={[styles.flag, { color: theme.accent }]}>odwołana</Text> : null}
        {lesson.substitution ? (
          <Text style={[styles.flag, { color: theme.accent }]}>
            zastępstwo{lesson.substitutionNote ? ` · ${lesson.substitutionNote}` : ''}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  weekBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  weekButton: { padding: 8 },
  weekButtonText: { fontSize: 15, fontWeight: '700' },
  weekLabel: { fontSize: 15, fontWeight: '700' },
  list: { padding: 16, paddingBottom: 40 },
  dayBlock: { marginBottom: 18 },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dayTitle: { fontSize: 18, fontWeight: '800', flexShrink: 1 },
  freeBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  freeBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  freeCard: { marginBottom: 8, paddingVertical: 12 },
  freeTitle: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  freeName: { fontSize: 16, fontWeight: '700' },
  noteCard: { marginBottom: 8, paddingVertical: 12 },
  noteText: { fontSize: 15, fontWeight: '600' },
  lesson: { flexDirection: 'row', gap: 12, marginBottom: 8, alignItems: 'flex-start' },
  hours: { width: 102, fontSize: 12, fontWeight: '700', paddingTop: 2, flexShrink: 0 },
  lessonBody: { flex: 1 },
  subject: { fontSize: 16, fontWeight: '700' },
  meta: { marginTop: 4, fontSize: 13 },
  flag: { marginTop: 4, fontSize: 13, fontWeight: '700' },
});
