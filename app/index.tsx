import { Redirect } from 'expo-router';

import { useAuth } from '@/src/auth/AuthContext';

export default function Index() {
  const { status } = useAuth();

  if (status === 'loggedOut') return <Redirect href="/login" />;
  if (status === 'selectChild') return <Redirect href="/select-child" />;
  if (status === 'ready') return <Redirect href="/(tabs)/messages" />;
  return null;
}
