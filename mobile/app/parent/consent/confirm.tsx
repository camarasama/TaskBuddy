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

import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { GradientHeader } from '@/components/GradientHeader';
import { Screen } from '@/components/Screen';
import { verifyConsent } from '@/lib/consentApi';
import { describeError } from '@/lib/errors';
import { spacing } from '@/theme';

type State = 'verifying' | 'done' | 'failed';

export default function ConsentConfirm() {
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
      <GradientHeader
        tone={state === 'done' ? 'success' : state === 'failed' ? 'amber' : 'teal'}
        icon={state === 'done' ? 'checkmark-circle' : state === 'failed' ? 'alert-circle' : 'shield-checkmark'}
        eyebrow="Parental consent"
        title={state === 'verifying' ? 'Confirming…' : state === 'done' ? "You're confirmed" : 'That did not work'}
      />

      {state === 'verifying' && <Callout kind="info">One moment while we check your confirmation link.</Callout>}
      {state === 'done' && <Callout kind="success">Thank you. You can add your children now.</Callout>}
      {state === 'failed' && (
        <Callout kind="warning" live>
          {message}
        </Callout>
      )}

      {state === 'done' && (
        <Button label="Add a child" onPress={() => router.replace('/(parent)/children')} />
      )}

      {state === 'failed' && (
        <View>
          <Button label="Try again" onPress={() => void run()} />
          <View style={styles.gap} />
          {/* A dead end here strands the one person the whole flow depends on. The consent screen can
              always send a fresh email, so it is the useful place to land, not the home screen. */}
          <Button
            label="Send a new email"
            variant="soft"
            onPress={() => router.replace('/(parent)/consent')}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { height: spacing[2] },
});
