/**
 * Root layout — wraps every route.
 *
 * The route groups this will host are `(parent)` and `(child)`, chosen at login. That split is
 * not cosmetic: a child session must have no navigable path into a parent screen, and separate
 * group layouts are how that is enforced structurally rather than by remembering to check a role
 * in each screen.
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Phones lose connectivity constantly and briefly. One quiet retry absorbs a walk past a
      // lift shaft; more than that just delays showing the user an honest error.
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
