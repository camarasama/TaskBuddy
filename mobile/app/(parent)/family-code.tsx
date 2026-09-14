/**
 * The QR a child scans to put this family's code on their phone.
 *
 * Not a tab — linked from the children screen, alongside signed-in devices.
 *
 * The code is shown as text underneath as well as encoded, deliberately. A parent needs to read it out
 * for the *web* child login, which has no QR by design, and for a phone whose camera will not focus.
 * Hiding it here would make the mobile flow the only way in, which is the opposite of what an onboarding
 * aid should do.
 */
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { GradientHeader } from '@/components/GradientHeader';
import { QRCode } from '@/components/QRCode';
import { Screen } from '@/components/Screen';
import { api, NetworkError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { buildJoinLink } from '@/lib/familyCodeStore';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

interface FamilyResponse {
  family: { id: string; familyName: string; familyCode: string };
}

/** The scan instructions are a real sequence, so they are numbered. */
const STEPS = [
  "Open TaskBuddy on your child's phone",
  'Tap "I\'m a child"',
  'Tap "Scan my parent\'s code" and point the camera here',
];

export default function FamilyCode() {
  const theme = useTheme();

  const { data, error, isPending, isError, refetch } = useQuery({
    queryKey: ['family', 'me'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get<FamilyResponse>('/families/me', { signal }),
  });

  const header = (
    <>
      <BackLink label="Back" />
      <GradientHeader
        tone="teal"
        icon="qr-code"
        eyebrow="Children"
        title="Your family code"
        subtitle="Scan it from your child's phone"
      />
    </>
  );

  if (isPending) {
    return (
      <Screen>
        {header}
        <Card>
          <AppText style={[styles.body, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        {header}
        <Callout kind="danger" title={offline ? 'No connection' : 'Could not load your family code'} live>
          {describeError(error)}
        </Callout>
        <Button label="Try again" onPress={() => void refetch()} />
      </Screen>
    );
  }

  const code = data.family.familyCode;

  return (
    <Screen scroll>
      {header}

      <Card>
        {STEPS.map((step, index) => (
          <View key={step} style={[styles.step, index > 0 && styles.stepGap]}>
            <View style={[styles.stepNumber, { backgroundColor: theme.accent }]}>
              <AppText style={[styles.stepNumberLabel, { color: theme.primary }]}>{index + 1}</AppText>
            </View>
            <AppText style={[styles.stepText, { color: theme.cardForeground }]}>{step}</AppText>
          </View>
        ))}

        <View style={styles.qrWrap}>
          {/* Fixed light background regardless of theme: a dark-mode QR with an inverted quiet zone is
              unreliable to scan, and the failure looks like a broken camera rather than a colour bug. */}
          <QRCode value={buildJoinLink(code)} size={240} />
        </View>

        <AppText style={[styles.body, styles.centre, { color: theme.mutedForeground }]}>
          You can also read this out. It&apos;s what a child types on the website, where there is no
          QR code.
        </AppText>
        <View style={[styles.codePill, { backgroundColor: theme.muted }]}>
          <AppText selectable style={[styles.code, { color: theme.cardForeground }]}>
            {code}
          </AppText>
        </View>
      </Card>

      <Callout kind="info" icon="lock-closed">
        Anyone with this code still needs a child&apos;s username and PIN to sign in. Share it with
        your family, not publicly.
      </Callout>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  centre: { textAlign: 'center' },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  stepGap: { marginTop: spacing[2] },
  stepNumber: { width: 28, height: 28, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  stepNumberLabel: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.bold },
  stepText: { flex: 1, fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  qrWrap: { alignItems: 'center', paddingVertical: spacing[4] },
  codePill: { borderRadius: radius.lg, paddingVertical: spacing[3], marginTop: spacing[3] },
  code: {
    fontSize: fontSize.xl.fontSize,
    lineHeight: fontSize.xl.lineHeight,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
    letterSpacing: 2,
  },
});
