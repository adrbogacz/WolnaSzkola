// App entry. Background tasks must be defined here, at the top level, not in app/_layout.tsx:
// when Android wakes the app for a background sync no screen is drawn, so layouts never load
// and the sync task would not exist ("No task registered for key expo-task-manager").
import './src/background/syncTask';
import 'expo-router/entry';
