import { looksLikeGradeMark } from './normalize';
import { isJunkGrade, tidyGradeComment } from './scrape';
import type { SchoolGrade } from './types';

export function combineGrades(options: {
  html?: SchoolGrade[];
  details?: SchoolGrade[];
  api?: SchoolGrade[];
  skillIds?: Iterable<string>;
}): SchoolGrade[] {
  const skillIds = new Set([...(options.skillIds ?? [])].map(String));
  const byKey = new Map<string, SchoolGrade>();
  const idToKey = new Map<string, string>();

  const ingest = (grade: SchoolGrade) => {
    const keepMark = grade.id.startsWith('html-table-') || grade.id.startsWith('html-skill-');
    const cleaned = !keepMark && skillIds.has(grade.value) ? { ...grade, value: '' } : grade;
    const numeric = gradeNumericId(cleaned.id);
    const subjectKey = cleaned.subject.toLowerCase();
    const sameSubject = [...byKey.entries()].find(([, current]) => {
      if (current.subject.toLowerCase() !== subjectKey) return false;
      if (!cleaned.date || !current.date) return true;
      return current.date === cleaned.date;
    });
    const key =
      (numeric ? idToKey.get(numeric) : undefined) ||
      (cleaned.date ? gradeKey(cleaned) : sameSubject?.[0]) ||
      gradeKey(cleaned);
    const existing = byKey.get(key);
    const merged = existing ? fuseGrades(existing, cleaned) : cleaned;
    if (sameSubject && sameSubject[0] !== key) {
      byKey.delete(sameSubject[0]);
      byKey.set(key, fuseGrades(sameSubject[1], merged));
    } else {
      byKey.set(key, merged);
    }
    if (numeric) idToKey.set(numeric, key);
  };

  for (const grade of options.html ?? []) ingest(grade);
  for (const grade of options.details ?? []) ingest(grade);
  for (const grade of options.api ?? []) ingest(grade);

  return [...byKey.values()]
    .map((grade) => ({ ...grade, comment: tidyGradeComment(grade) }))
    .filter((grade) => !isJunkGrade(grade));
}

export function gradeNumericId(id: string): string {
  const match = id.match(/(\d{3,})$/);
  return match?.[1] && match[1] !== '000000' ? match[1] : '';
}

function gradeKey(grade: SchoolGrade): string {
  if (grade.date) return `${grade.date}|${grade.subject.toLowerCase()}`;
  const id = gradeNumericId(grade.id);
  if (id) return `id:${id}`;
  return `${grade.subject.toLowerCase()}|${grade.teacher.toLowerCase()}`;
}

function markSourceRank(id: string): number {
  if (id.startsWith('html-table-') || id.startsWith('html-skill-')) return 5;
  if (id.startsWith('html-')) return 4;
  if (id.startsWith('szczegoly-')) return 1;
  return 0;
}

function fuseGrades(left: SchoolGrade, right: SchoolGrade): SchoolGrade {
  const leftMark = looksLikeGradeMark(left.value) ? left.value : '';
  const rightMark = looksLikeGradeMark(right.value) ? right.value : '';
  const leftRank = markSourceRank(left.id);
  const rightRank = markSourceRank(right.id);
  let value = leftMark;
  if (!value) value = rightMark;
  else if (rightMark && rightMark !== leftMark && rightRank > leftRank) value = rightMark;

  const namedCategory = (grade: SchoolGrade) =>
    grade.category && grade.category !== 'Ocena' ? grade.category : '';
  const namedSubject = (grade: SchoolGrade) =>
    grade.subject && grade.subject !== 'Przedmiot' && grade.subject !== 'Ocena' ? grade.subject : '';

  return {
    ...left,
    id: leftRank >= rightRank ? left.id : right.id,
    value,
    subject: namedSubject(left) || namedSubject(right) || left.subject || right.subject,
    category: namedCategory(left) || namedCategory(right) || left.category || right.category,
    date: left.date || right.date,
    teacher: left.teacher || right.teacher,
    comment: tidyGradeComment({
      ...left,
      comment: [left.comment, right.comment].filter(Boolean).join('\n'),
    }),
    semester: left.semester || right.semester,
    isSemester: left.isSemester || right.isSemester,
    isFinal: left.isFinal || right.isFinal,
    isProposition: left.isProposition || right.isProposition,
    isFormative: Boolean(left.isFormative || right.isFormative),
  };
}
