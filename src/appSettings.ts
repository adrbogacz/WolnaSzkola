export const SYNC_INTERVAL_OPTIONS = [
  { label: 'Wyłączone', minutes: 0 },
  { label: '10 min', minutes: 10 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 h', minutes: 60 },
  { label: '3 h', minutes: 180 },
  { label: '6 h', minutes: 360 },
  { label: '12 h', minutes: 720 },
] as const;

export const SUPPORT_EMAIL = 'wolnaszkola@proton.me';

export const REGULAMIN_WARNING =
  'Bardzo częste sprawdzanie skrzynki (częściej niż co 15 minut) może na jakiś czas zablokować konto w dzienniku.';

export type HideStatus = 'archived' | 'deleted';

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODE_OPTIONS: readonly { label: string; mode: ThemeMode }[] = [
  { label: 'Jak w telefonie', mode: 'system' },
  { label: 'Jasny', mode: 'light' },
  { label: 'Ciemny', mode: 'dark' },
];

export type AppSettings = {
  showArchived: boolean;
  syncIntervalMinutes: number;
  themeMode: ThemeMode;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  showArchived: false,
  syncIntervalMinutes: 0,
  themeMode: 'system',
};
