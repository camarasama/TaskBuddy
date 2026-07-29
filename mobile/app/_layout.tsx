/**
 * Root layout — wraps every route.
 *
 * Hosts the `(parent)` and `(child)` route groups, chosen at sign-in. That split is not cosmetic: a
 * child session must have no navigable path into a parent screen, and a per-group layout check is how
 * that is enforced in one place per shell instead of once per screen. Screens added to a group inherit
 * the guard automatically — see the comment in each group's `_layout.tsx`.
 *
 * This layout also owns session bootstrap, and deliberately renders nothing but a spinner until it
 * finishes. Mounting the navigator first would show the role chooser for a frame on every cold start
 * of an already-signed-in device, and that flash reads as a bug.
 */
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionExpiredError } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Phones lose connectivity constantly and briefly. One quiet retry absorbs a walk past a
      // lift shaft; more than that just delays showing the user an honest error.
      retry: (failureCount, error) => {
        // A dead session will not recover by asking again, and each attempt costs a refresh.
        if (error instanceof SessionExpiredError) return false;
        return failureCount < 1;
      },
      staleTime: 30_000,
    },
  },
});

function Splash() {
  const theme = useTheme();
  return (
    <View style={[styles.splash, { backgroundColor: theme.appBackground }]}>
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );
}

function Routes() {
  const status = useAuth((state) => state.status);
  const bootstrap = useAuth((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'loading') return <Splash />;

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Routes />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
