/**
 * `/parent/consent/confirm` — the landing screen for the emailed consent link.
 *
 * ## Why this path, and why not inside `(parent)`
 *
 * An Android App Link is matched on the **real URL path** of the link in the email, which
 * `ConsentService` builds as `<FRONTEND_URL>/parent/consent/confirm?token=…`. Expo Router derives
 * routes from the file tree and a parenthesised segment is a *group*: `(parent)/consent.tsx` serves
 * `/consent`, not `/parent/consent`. So a screen inside the group could never catch this link no
 * matter what the intent filter said. Hence a literal `parent/consent/` directory, whose only job is
 * to sit at the address the email actually points to.
 *
 * Being outside `(parent)` is also correct rather than incidental: that group's layout guards on a
 * parent session, and the whole point of this screen is that it works **without one**. A parent
 * opening the link on a phone they have never signed in on is the normal case, not the edge case.
 *
 * ## The token is the proof
 *
 * `POST /consent/verify` is public and looks the record up by token hash, so nothing here needs an
 * account, and no family id appears in the URL to tamper with. A second tap on the same link
 * resolves rather than failing, because the server treats a re-click as idempotent — a parent who
 * double-taps must not be told their link is broken.
 *
 * Mirrors `frontend/src/app/parent/consent/confirm/page.tsx`.
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { verifyConsent } from '@/lib/consentApi';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

type State = 'verifying' | 'done' | 'failed';

export default function ConsentConfirm() {
  const theme = useTheme();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [state, setState] = useState<State>('verifying');
  const [message, setMessage] = useState('');

  const run = useCallback(async () => {
    if (!token) {
      setState('failed');
      setMessage('That link is missing its confirmation code. Open the link from the email again.');
      return;
    }
    setState('verifying');
    try {
      await verifyConsent(token);
      setState('done');
    } catch (caught) {
      setState('failed');
      setMessage(describeError(caught));
    }
  }, [token]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <Screen>
      <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
        {state === 'verifying' ? 'Confirming…' : state === 'done' ? "You're confirmed" : 'That did not work'}
      </AppText>

      <Card>
        <AppText style={[styles.body, { color: theme.cardForeground }]}>
          {state === 'verifying' && 'One moment while we check your confirmation link.'}
          {state === 'done' && 'Thank you. You can add your children now.'}
          {state === 'failed' && message}
        </AppText>
      </Card>

      {state === 'done' && (
        <View style={styles.actions}>
          <Button label="Add a child" onPress={() => router.replace('/(parent)/children')} />
        </View>
      )}

      {state === 'failed' && (
        <View style={styles.actions}>
          <Button label="Try again" onPress={() => void run()} />
          <View style={styles.gap} />
          {/* A dead end here strands the one person the whole flow depends on. The consent screen can
              always send a fresh email, so it is the useful place to land, not the home screen. */}
          <Button
            label="Send a new email"
            variant="secondary"
            onPress={() => router.replace('/(parent)/consent')}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[4],
  },
  body: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight },
  actions: { marginTop: spacing[5] },
  gap: { height: spacing[2] },
});
