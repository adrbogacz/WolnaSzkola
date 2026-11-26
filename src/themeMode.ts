import { Appearance, Platform } from 'react-native';

import type { ThemeMode } from '@/src/appSettings';

/** Forces light or dark for the whole app (headers, dialogs, status bar), or hands it back to the phone. */
export function applyThemeMode(mode: ThemeMode) {
  if (Platform.OS === 'web') return;
  try {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  } catch {
    // Older native module without setColorScheme: keep following the phone.
  }
}
