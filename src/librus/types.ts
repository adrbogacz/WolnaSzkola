export type ChildAccount = {
  id: number;
  login: string;
  studentName: string;
  accessToken: string;
  state: string;
};

export type SchoolMessage = {
  id: string;
  topic: string;
  body: string;
  sentAt: string;
  sender: string;
  senderId?: string;
  read: boolean;
  hasAttachments: boolean;
  kind: 'inbox' | 'notice' | 'sent';
};

export type SchoolReceiverGroup = {
  id: string;
  label: string;
};

export type SchoolReceiver = {
  id: string;
  name: string;
  group?: string;
  typeId?: string;
};

export type SchoolGrade = {
  id: string;
  value: string;
  subject: string;
  subjectId: string;
  category: string;
  date: string;
  teacher: string;
  comment?: string;
  semester: number;
  isSemester: boolean;
  isFinal: boolean;
  isProposition: boolean;
  isFormative?: boolean;
};

export type SchoolAttendance = {
  id: string;
  date: string;
  lessonNo: number;
  typeName: string;
  typeShort: string;
  isPresence: boolean;
  color: string;
  subject?: string;
};

export type SchoolLesson = {
  id: string;
  subject: string;
  teacher: string;
  classroom: string;
  hourFrom: string;
  hourTo: string;
  cancelled: boolean;
  substitution: boolean;
  substitutionNote?: string;
};

export type SchoolDayPlan = {
  date: string;
  lessons: SchoolLesson[];
  free?: boolean;
  freeLabel?: string;
  notes?: string[];
};

export type JsonMap = Record<string, unknown>;
