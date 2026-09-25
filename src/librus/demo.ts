import { addDays, isoDate, mondayOf } from '@/src/format';

import type {
  ChildAccount,
  SchoolAttendance,
  SchoolDayPlan,
  SchoolGrade,
  SchoolMessage,
  SchoolReceiver,
} from './types';

export const DEMO_CHILD: ChildAccount = {
  id: 1,
  login: 'demo',
  studentName: 'Jan Kowalski',
  accessToken: 'demo',
  state: 'active',
};

export const DEMO_MESSAGES: SchoolMessage[] = [
  {
    id: 'm1',
    topic: 'Wycieczka do muzeum — zgody do piątku',
    body: 'Dzień dobry,\n\nprzypominam o zgodach na wycieczkę do Muzeum Śląskiego. Proszę o odesłanie kartki do piątku.\n\nPozdrawiam,\nAnna Nowak',
    sentAt: '2026-09-12 18:42:00',
    sender: 'Anna Nowak',
    senderId: '10',
    read: false,
    hasAttachments: false,
    kind: 'inbox',
  },
  {
    id: 'm2',
    topic: 'Sprawdzian z działu ułamki',
    body: 'W przyszły wtorek sprawdzian z ułamków zwykłych i dziesiętnych. Proszę o powtórkę zadań z zeszytu ćwiczeń, strony 24–31.',
    sentAt: '2026-09-10 12:15:00',
    sender: 'Piotr Zieliński',
    senderId: '11',
    read: true,
    hasAttachments: false,
    kind: 'inbox',
  },
  {
    id: 'm3',
    topic: 'Zebranie z rodzicami',
    body: 'Zapraszam na zebranie 24 września o 17:30 w sali 12. Omówimy plan wycieczek i zasady oceniania.',
    sentAt: '2026-09-08 09:03:00',
    sender: 'Anna Nowak',
    senderId: '10',
    read: true,
    hasAttachments: true,
    kind: 'inbox',
  },
];

export const DEMO_SENT: SchoolMessage[] = [
  {
    id: '6-demo-1',
    topic: 'Re: Wycieczka do muzeum — zgody do piątku',
    body: 'Dzień dobry,\n\npotwierdzam zgodę na wycieczkę. Kartkę oddamy w poniedziałek.\n\nPozdrawiam',
    sentAt: '2026-09-13 09:10:00',
    sender: 'Anna Nowak',
    senderId: '10',
    read: true,
    hasAttachments: false,
    kind: 'sent',
  },
];

export const DEMO_ANNOUNCEMENTS: SchoolMessage[] = [
  {
    id: 'a-demo-1',
    topic: 'Małopolski Konkurs Języka Angielskiego',
    body: 'Zapraszamy do udziału w Małopolskim Konkursie Języka Angielskiego. Etap szkolny odbędzie się 15 października. Można zgłaszać się do nauczycieli języka angielskiego do dnia 8 października.',
    sentAt: '2026-09-14',
    sender: 'Karolina Auzbiter - Mikunda',
    read: false,
    hasAttachments: false,
    kind: 'notice',
  },
  {
    id: 'a-demo-2',
    topic: 'Szkolny konkurs fotograficzny',
    body: 'Zapraszamy uczniów do udziału w szkolnym konkursie fotograficznym. Szczegóły u organizatorów.',
    sentAt: '2026-09-10',
    sender: 'Jolanta Adamiec',
    read: true,
    hasAttachments: false,
    kind: 'notice',
  },
];

export const DEMO_RECEIVERS: SchoolReceiver[] = [
  { id: '10', name: 'Anna Nowak', group: 'Wychowawcy', typeId: 'wychowawca' },
  { id: '11', name: 'Piotr Zieliński', group: 'Nauczyciele', typeId: 'nauczyciel' },
  { id: '12', name: 'Ewa Król', group: 'Nauczyciele', typeId: 'nauczyciel' },
  { id: '21', name: 'Katarzyna Wiśniewska', group: 'Rodzice', typeId: 'rodzic' },
  { id: '22', name: 'Marek Lewandowski', group: 'Rodzice', typeId: 'rodzic' },
  { id: '31', name: 'Joanna Baran', group: 'Rady klasowe rodziców', typeId: 'rada' },
];

export const DEMO_GRADES: SchoolGrade[] = [
  {
    id: 'g1',
    value: '5',
    subject: 'Matematyka',
    subjectId: '1',
    category: 'Sprawdzian',
    date: '2026-09-11',
    teacher: 'Piotr Zieliński',
    semester: 1,
    isSemester: false,
    isFinal: false,
    isProposition: false,
  },
  {
    id: 'g2',
    value: '4+',
    subject: 'Matematyka',
    subjectId: '1',
    category: 'Kartkówka',
    date: '2026-09-04',
    teacher: 'Piotr Zieliński',
    semester: 1,
    isSemester: false,
    isFinal: false,
    isProposition: false,
  },
  {
    id: 'g3',
    value: '5',
    subject: 'Język polski',
    subjectId: '2',
    category: 'Wypracowanie',
    date: '2026-09-09',
    teacher: 'Ewa Król',
    comment: 'Płynna argumentacja, ładny język.',
    semester: 1,
    isSemester: false,
    isFinal: false,
    isProposition: false,
  },
  {
    id: 'g4',
    value: '3',
    subject: 'Historia',
    subjectId: '3',
    category: 'Odpowiedź ustna',
    date: '2026-09-07',
    teacher: 'Marek Lis',
    semester: 1,
    isSemester: false,
    isFinal: false,
    isProposition: false,
  },
];

export const DEMO_ATTENDANCE: SchoolAttendance[] = [
  {
    id: 'a1',
    date: '2026-09-14',
    lessonNo: 3,
    typeName: 'Spóźnienie',
    typeShort: 'sp',
    isPresence: true,
    color: '#B45309',
    subject: 'Matematyka',
  },
  {
    id: 'a2',
    date: '2026-09-11',
    lessonNo: 5,
    typeName: 'Nieobecność usprawiedliwiona',
    typeShort: 'u',
    isPresence: false,
    color: '#1D4E89',
    subject: 'WF',
  },
  {
    id: 'a3',
    date: '2026-09-08',
    lessonNo: 1,
    typeName: 'Nieobecność nieusprawiedliwiona',
    typeShort: 'nb',
    isPresence: false,
    color: '#B42318',
    subject: 'Język polski',
  },
];

export function demoTimetable(weekStart: string): SchoolDayPlan[] {
  const monday = new Date(`${weekStart}T12:00:00`);
  const days = [0, 1, 2, 3, 4].map((offset) => isoDate(addDays(monday, offset)));
  const subjects = [
    ['Matematyka', 'Język polski', 'Historia', 'Angielski', 'WF'],
    ['Przyroda', 'Matematyka', 'Muzyka', 'Język polski', 'Technika'],
    ['Angielski', 'Historia', 'Matematyka', 'Plastyka', 'Religia'],
    ['Język polski', 'WF', 'Przyroda', 'Matematyka', 'Angielski'],
    ['Historia', 'Matematyka', 'Język polski', 'Informatyka', 'Godzina wychowawcza'],
  ];

  return days.map((date, dayIndex) => {
    if (dayIndex === 2) {
      return {
        date,
        lessons: [],
        free: true,
        freeLabel: 'Dzień Edukacji Narodowej',
      };
    }
    return {
      date,
      lessons: subjects[dayIndex]!.map((subject, lessonIndex) => ({
        id: `${date}-${lessonIndex}`,
        subject,
        teacher: 'Nauczyciel',
        classroom: `${10 + lessonIndex}`,
        hourFrom: ['08:00', '08:55', '09:50', '10:55', '11:50'][lessonIndex]!,
        hourTo: ['08:45', '09:40', '10:35', '11:40', '12:35'][lessonIndex]!,
        cancelled: false,
        substitution: dayIndex === 3 && lessonIndex === 1,
      })),
    };
  });
}

export function currentDemoWeekStart(): string {
  return isoDate(mondayOf());
}
