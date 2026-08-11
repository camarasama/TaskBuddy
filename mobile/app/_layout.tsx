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
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { subscribeAppFocus } from '@/lib/appFocus';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorScreen } from '@/components/ErrorScreen';
import { NotificationWatcher } from '@/components/NotificationWatcher';
import { ToastProvider } from '@/components/Toast';
import { isRateLimited, SessionExpiredError } from '@/lib/api';
import { initReporting, reportError } from '@/lib/reporting';
import { setPushBridge, useAuth } from '@/stores/auth';
import { registerForPush, subscribeToNotificationTaps, unregisterFromPush } from '@/lib/push';
import { useTheme } from '@/theme';
import { FontProvider } from '@/theme/FontProvider';

/**
 * expo-router renders this in place of any route that throws during render, and — because it is
 * exported from the *root* layout — for every route that does not export its own.
 *
 * The report goes in an effect keyed on the error, not in the render body: the fallback can re-render
 * (a theme change, a parent update) and a render-phase side effect would file the same crash again
 * each time.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  useEffect(() => {
    reportError(error, 'render');
  }, [error]);

  return <ErrorScreen error={error} retry={retry} />;
}

/**
 * Teach React Query what "focused" means on a phone.
 *
 * ⚠️ `refetchOnWindowFocus` defaults to true and does NOTHING in React Native: it listens for a
 * browser `window` focus event that never fires here. Without this listener the only refetch trigger
 * is a query mounting, so data goes stale the moment the app is backgrounded and stays stale until
 * the screen is remounted.
 *
 * That is not theoretical. A parent returned a submitted task and the child's app kept showing it as
 * submitted; the only way to see the change was to sign out and back in, which remounts everything.
 * The child app has no socket client — realtime events are web-only — so refetch-on-foreground is
 * the whole mechanism by which a child learns that a parent did something.
 *
 * Registered at module scope so it is set before any query can run.
 */
focusManager.setEventListener(subscribeAppFocus);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Phones lose connectivity constantly and briefly. One quiet retry absorbs a walk past a
      // lift shaft; more than that just delays showing the user an honest error.
      retry: (failureCount, error) => {
        // A dead session will not recover by asking again, and each attempt costs a refresh.
        if (error instanceof SessionExpiredError) return false;
        /**
         * Never retry a 429. The limiter is 100 requests per 15 minutes keyed on **IP**, so a retry
         * does not merely fail again — it spends another request from an already-empty bucket and
         * pushes the window out for every device sharing that address. Retrying here was actively
         * making the problem worse, found while testing on a phone alongside a browser on the same
         * home connection.
         */
        if (isRateLimited(error)) return false;
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
    initReporting();
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'loading') return <Splash />;

  return (
    <>
      {/*
        Renders nothing; polls the unread count and raises a toast when it grows. Mounted here rather
        than per-shell so one watcher serves both roles and survives navigation between them.
      */}
      <NotificationWatcher />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

/**
 * Hand the auth store its push implementation.
 *
 * Module scope, so it is set before any screen can trigger a sign-in. The store deliberately does
 * not import `@/lib/push` itself — see the note on `setPushBridge`.
 */
setPushBridge({ register: registerForPush, unregister: unregisterFromPush });

export default function RootLayout() {
  // A tapped notification should land on the thing it is about, not the home screen. Registered
  // here rather than in the push module because navigation belongs to the app layer.
  useEffect(() => subscribeToNotificationTaps((url) => router.push(url as never)), []);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        {/* Outside <Routes> so the faces start loading during session bootstrap rather than after it. */}
        <FontProvider>
          <StatusBar style="auto" />
          {/*
            Outside <Routes> too, and inside SafeAreaProvider because the toast offsets itself by the
            top inset. Wrapping the navigator means a toast survives a screen change — an action that
            navigates on success can still confirm itself.
          */}
          <ToastProvider>
            <Routes />
          </ToastProvider>
        </FontProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
