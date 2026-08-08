/**
 * Parental consent (COPPA) — mobile port of `frontend/src/app/parent/consent/page.tsx`.
 *
 * Not a tab, reached the same way the web page is: from a `CONSENT_REQUIRED` failure when a parent
 * tries to add a child, and from Settings. `href: null` in `_layout.tsx` keeps it off the bar for the
 * same six-tabs-do-not-fit-a-phone reason as `devices` and `co-parents`.
 *
 * ## What did NOT get ported
 *
 * The web has a second page, `/parent/consent/confirm`, for the link inside the consent email. That
 * page is reached by opening the email in a browser — `ConsentService.initiate` builds the link from
 * `FRONTEND_URL`, a plain web URL, not a deep link into this app. Catching it here would mean
 * registering a URL scheme / App Link and is new native surface, which is out of scope for this port
 * (see `consentApi.ts`). So this screen only ever *shows* `status`; the parent completes verification
 * wherever their phone already has a browser, same as today.
 *
 * ## Honesty about `pending` and `revoked`
 *
 * `verified` is the only state that gets the reassuring card. Every other state — including
 * `revoked`, which is not merely "never asked" — explains what is missing and offers the one action
 * that fixes it. A parent who is mid-flow (`pending`) is told to check their email, not shown a
 * disguised success screen. `revoked` reads identically to `none` here, same as the web page it is
 * ported from: the resolution is the same "email me the link" action either way, and inventing new
 * copy for a state the reference implementation does not distinguish would be guessing at semantics
 * rather than carrying them over.
 */
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { NetworkError } from '@/lib/api';
import { CONSENT_STATUS_KEY, consentStatusQuery, requestConsent } from '@/lib/consentApi';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

export default function Consent() {
  const theme = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);

  const { data, error, isPending, isError, refetch } = useQuery(consentStatusQuery());

  const { mutateAsync: send } = useMutation({ mutationFn: requestConsent });

  const handleRequest = useCallback(async () => {
    setSending(true);
    try {
      const result = await send();
      toast.show(result.message, 'success');
      await queryClient.invalidateQueries({ queryKey: CONSENT_STATUS_KEY });
    } catch (caught) {
      toast.show(describeError(caught), 'error');
    } finally {
      setSending(false);
    }
  }, [send, toast, queryClient]);

  if (isPending) {
    return (
      <Screen>
        <Card>
          <AppText style={[styles.detail, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  // A failed status check is never a negative result — it is the app not knowing, which is a very
  // different thing to tell a parent than "you haven't consented yet". Collapsing the two would make
  // a dropped connection look like a compliance problem.
  if (isError || !data) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <Card>
          <AppText style={[styles.heading, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not check your consent status'}
          </AppText>
          <AppText style={[styles.detail, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <View style={styles.action}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  if (data.status === 'verified') {
    return (
      <Screen scroll>
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
          You&apos;re all set
        </AppText>
        <Card>
          <AppText style={[styles.detail, { color: theme.cardForeground }]}>
            We have your consent on record. You can add your children now.
          </AppText>
          <View style={styles.action}>
            <Button label="Add a child" onPress={() => router.push('/(parent)/children')} />
          </View>
        </Card>
      </Screen>
    );
  }

  const pending = data.status === 'pending';

  return (
    <Screen scroll>
      <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
        {pending ? 'Check your email' : 'Confirm you are the parent'}
      </AppText>

      <Card>
        {pending ? (
          <AppText style={[styles.detail, { color: theme.cardForeground }]}>
            We&apos;ve sent you a confirmation link. Open it and TaskBuddy will let you add your
            children straight away. It can take a minute to arrive — check your spam folder too.
          </AppText>
        ) : (
          <View>
            <AppText style={[styles.detail, { color: theme.cardForeground }]}>
              TaskBuddy is used by children, so before we create an account for yours the law
              requires us to confirm that you are their parent or guardian.
            </AppText>
            <AppText style={[styles.detail, styles.paragraphGap, { color: theme.cardForeground }]}>
              We&apos;ll email you a link. Following it records your consent — that&apos;s the whole
              process, and it only needs doing once.
            </AppText>
            <AppText
              style={[styles.detail, styles.paragraphGap, { color: theme.mutedForeground }]}
            >
              We use your child&apos;s information only to run TaskBuddy. We never sell it or share
              it with advertisers, and you can withdraw consent at any time.
            </AppText>
          </View>
        )}

        <View style={styles.action}>
          <Button
            label={pending ? 'Send it again' : 'Email me the link'}
            onPress={() => void handleRequest()}
            busy={sending}
            disabled={sending}
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[4],
  },
  heading: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  detail: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  paragraphGap: { marginTop: spacing[3] },
  action: { marginTop: spacing[4] },
});
