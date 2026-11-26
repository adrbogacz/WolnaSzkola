// App settings (appearance, background sync, archive) and the contrast helper used for badges.
import { textOn } from '../constants/Colors';
import { loadAppSettings, saveAppSettings } from '../src/storage';

let failed = 0;
function assert(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`ok  ${label}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${label}`);
  if (detail !== undefined) console.error(detail);
}

const fresh = await loadAppSettings();
assert('appearance follows the phone by default', fresh.themeMode === 'system', fresh);

await saveAppSettings({ themeMode: 'dark' });
await saveAppSettings({ syncIntervalMinutes: 180 });
let stored = await loadAppSettings();
assert('changing the sync interval keeps the chosen appearance', stored.themeMode === 'dark', stored);
assert('changing the appearance keeps the sync interval', stored.syncIntervalMinutes === 180, stored);

await Promise.all([saveAppSettings({ showArchived: true }), saveAppSettings({ themeMode: 'light' })]);
stored = await loadAppSettings();
assert('two quick changes are both kept', stored.showArchived && stored.themeMode === 'light', stored);

const SecureStore = await import('expo-secure-store');
await SecureStore.setItemAsync('wolnaszkola.settings', JSON.stringify({ themeMode: 'purple', syncIntervalMinutes: 60 }));
stored = await loadAppSettings();
assert('unknown appearance falls back to the phone', stored.themeMode === 'system', stored);

assert('pale green attendance badge gets dark text', textOn('#9BE89B') !== '#FFFFFF');
assert('dark green grade badge keeps white text', textOn('#3F7D4E') === '#FFFFFF');
assert('rgb() colours are understood', textOn('rgb(250, 250, 210)') !== '#FFFFFF');
assert('unknown colour keeps white text', textOn('transparent') === '#FFFFFF');

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
