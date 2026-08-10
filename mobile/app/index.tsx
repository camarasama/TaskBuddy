/**
 * Role chooser — the app's entry point.
 *
 * Two doors rather than one combined form, because the two credentials have nothing in common: a
 * parent signs in with email and password, a child with a family code, a username and a 4-digit PIN.
 * A single screen trying to serve both would have to guess which the user meant from what they typed.
 *
 * A signed-in session never sees this screen: it redirects into the matching shell. That redirect is
 * also what makes sign-out land somewhere sensible without the sign-out button knowing any routes.
 */
import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';

import { Button } from '@/components/Button';
import { Logo } from '@/components/Logo';
import { Screen } from '@/components/Screen';
import { VersionBadge } from '@/components/VersionBadge';
import { CONFIG_ERRORS } from '@/lib/config';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

export default function RoleChooser() {
  const theme = useTheme();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
  const offline = useAuth((state) => state.offline);

  /**
   * Already signed in — hand straight over to the right shell.
   *
   * Only the two roles that *have* a shell are redirected. Sending any other role to a shell would
   * ping-pong: the group layout would refuse it and bounce back here, which bounces it out again. A
   * signed-in admin should be unreachable — `stores/auth.ts` rejects the role at both sign-in and
   * bootstrap — but "unreachable" plus "infinite redirect loop" is a bad pair to rely on, so an
   * unexpected role falls through to the chooser below instead.
   */
  if (status === 'signedIn' && user) {
    if (user.role === 'parent') return <Redirect href="/(parent)/dashboard" />;
    if (user.role === 'child') return <Redirect href="/(child)/dashboard" />;
  }

  return (
    <Screen scroll center footer={<VersionBadge />}>
      {/*
        The lockup already contains the wordmark, so there is no text heading under it — a rendered
        "TaskBuddy" beneath a logo that reads "TaskBuddy" looks like a mistake. That also flips the
        image to ANNOUNCED rather than decorative: it is now the only place the app's name exists on
        this screen, and hiding it would leave a screen-reader user with an unnamed app.
      */}
      <Logo width={156} />
      <AppText style={[styles.subtitle, { color: theme.mutedForeground }]}>
        Family tasks, rewards and a bit of friendly competition.
      </AppText>

      {/* A broken app.config is otherwise invisible until the first request fails confusingly. */}
      {CONFIG_ERRORS.length > 0 && (
        <View style={[styles.notice, { borderColor: theme.destructive, backgroundColor: theme.card }]}>
          <AppText style={[styles.noticeTitle, { color: theme.destructive }]}>Configuration problem</AppText>
          {CONFIG_ERRORS.map((message) => (
            <AppText key={message} style={[styles.noticeBody, { color: theme.cardForeground }]}>
              {message}
            </AppText>
          ))}
        </View>
      )}

      {/*
        Distinguishes "we could not reach the server just now" from "your session ended". The stored
        credential was kept in the offline case, so signing in again is likely unnecessary once there
        is signal — saying so avoids a pointless password entry.
      */}
      {offline && (
        <View style={[styles.notice, { borderColor: theme.border, backgroundColor: theme.card }]}>
          <AppText style={[styles.noticeTitle, { color: theme.cardForeground }]}>You appear to be offline</AppText>
          <AppText style={[styles.noticeBody, { color: theme.mutedForeground }]}>
            We could not reach TaskBuddy to restore your session. Your sign-in has been kept — try
            again once you have a connection.
          </AppText>
        </View>
      )}

      <View style={styles.actions}>
        <Button label="I'm a parent" onPress={() => router.push('/login')} />
        <Button label="I'm a kid" variant="secondary" onPress={() => router.push('/child-login')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Centred to sit under the logo. The notices and buttons below stay full-width and left-aligned —
  // this is the tagline of a lockup, not a centred screen.
  subtitle: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    marginTop: spacing[2],
    marginBottom: spacing[8],
    textAlign: 'center',
  },
  notice: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing[4],
    marginBottom: spacing[4],
  },
  noticeTitle: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[1],
  },
  noticeBody: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  actions: { gap: spacing[3] },
});
