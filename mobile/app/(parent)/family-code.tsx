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
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { QRCode } from '@/components/QRCode';
import { Screen } from '@/components/Screen';
import { api, NetworkError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { buildJoinLink } from '@/lib/familyCodeStore';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

interface FamilyResponse {
  family: { id: string; familyName: string; familyCode: string };
}

export default function FamilyCode() {
  const theme = useTheme();

  const { data, error, isPending, isError, refetch } = useQuery({
    queryKey: ['family', 'me'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get<FamilyResponse>('/families/me', { signal }),
  });

  if (isPending) {
    return (
      <Screen>
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
        <Card>
          <AppText style={[styles.heading, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load your family code'}
          </AppText>
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <View style={styles.action}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  const code = data.family.familyCode;

  return (
    <Screen scroll>
      <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
        Your family code
      </AppText>
      <AppText style={[styles.body, { color: theme.mutedForeground }]}>
        On your child&apos;s phone, open TaskBuddy, tap &quot;I&apos;m a child&quot; and then
        &quot;Scan my parent&apos;s code&quot;. Point their camera at this.
      </AppText>

      <Card>
        <View style={styles.qrWrap}>
          {/* Fixed light background regardless of theme — a dark-mode QR with an inverted quiet zone is
              unreliable to scan, and the failure looks like a broken camera rather than a colour bug. */}
          <QRCode value={buildJoinLink(code)} size={240} />
        </View>

        <AppText style={[styles.code, { color: theme.cardForeground }]}>{code}</AppText>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          You can also read this out. It&apos;s what a child types on the website, where there is no
          QR code.
        </AppText>
      </Card>

      <Card>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          Anyone with this code still needs a child&apos;s username and PIN to sign in. Share it with
          your family, not publicly.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[2] },
  qrWrap: { alignItems: 'center', paddingVertical: spacing[3] },
  code: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
    letterSpacing: 4,
    marginTop: spacing[3],
  },
  action: { marginTop: spacing[4] },
});
