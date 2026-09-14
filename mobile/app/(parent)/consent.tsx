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
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { GradientHeader } from '@/components/GradientHeader';
import { IconTile, type IoniconName } from '@/components/IconTile';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { NetworkError } from '@/lib/api';
import { CONSENT_STATUS_KEY, consentStatusQuery, requestConsent } from '@/lib/consentApi';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';
import type { AccentTone } from '@/theme/accents';

/** The three things a parent needs to know before asking for the link, one point each. */
const POINTS: { icon: IoniconName; tone: AccentTone; title: string; text: string }[] = [
  {
    icon: 'shield-checkmark',
    tone: 'primary',
    title: 'The law asks us to check',
    text: 'TaskBuddy is used by children, so before we create an account for yours the law requires us to confirm that you are their parent or guardian.',
  },
  {
    icon: 'mail',
    tone: 'primary',
    title: 'We email you a link',
    text: "Following it records your consent. That's the whole process, and it only needs doing once.",
  },
  {
    icon: 'heart',
    tone: 'success',
    title: "Your child's data stays yours",
    text: 'We use it only to run TaskBuddy. We never sell it or share it with advertisers, and you can withdraw consent at any time.',
  },
];

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
        <GradientHeader tone="teal" icon="shield-checkmark" eyebrow="Parental consent" title="Checking…" />
      </Screen>
    );
  }

  // A failed status check is never a negative result: it is the app not knowing, which is a very
  // different thing to tell a parent than "you haven't consented yet". Collapsing the two would make
  // a dropped connection look like a compliance problem.
  if (isError || !data) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <GradientHeader tone="teal" icon="shield-checkmark" eyebrow="Parental consent" title="Consent" />
        <Callout kind="danger" title={offline ? 'No connection' : 'Could not check your consent status'} live>
          {describeError(error)}
        </Callout>
        <Button label="Try again" onPress={() => void refetch()} />
      </Screen>
    );
  }

  if (data.status === 'verified') {
    return (
      <Screen scroll>
        <GradientHeader tone="success" icon="checkmark-circle" eyebrow="Parental consent" title="You're all set" />
        <Callout kind="success" title="We have your consent on record">
          You can add your children now.
        </Callout>
        <Button label="Add a child" onPress={() => router.push('/(parent)/children')} />
      </Screen>
    );
  }

  const pending = data.status === 'pending';

  return (
    <Screen scroll>
      <GradientHeader
        tone="teal"
        icon={pending ? 'mail-unread' : 'shield-checkmark'}
        eyebrow="Before you add a child"
        title={pending ? 'Check your email' : 'Confirm you are the parent'}
        subtitle={pending ? undefined : 'It only needs doing once'}
      />

      {pending ? (
        <Callout kind="success" icon="mail" title="We've sent you a confirmation link">
          Open it and TaskBuddy will let you add your children straight away. It can take a minute to
          arrive, so check your spam folder too.
        </Callout>
      ) : (
        <Card>
          {POINTS.map((point, index) => (
            <View key={point.title} style={[styles.point, index > 0 && [styles.pointGap, { borderTopColor: theme.border }]]}>
              <IconTile tone={point.tone} icon={point.icon} size={40} />
              <View style={styles.grow}>
                <AppText style={[styles.heading, { color: theme.cardForeground }]}>{point.title}</AppText>
                <AppText style={[styles.detail, { color: theme.mutedForeground }]}>{point.text}</AppText>
              </View>
            </View>
          ))}
        </Card>
      )}

      <Button
        label={pending ? 'Send it again' : 'Email me the link'}
        variant={pending ? 'soft' : 'primary'}
        onPress={() => void handleRequest()}
        busy={sending}
        disabled={sending}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  pointGap: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[3] },
  grow: { flex: 1 },
  heading: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  detail: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
});
