/**
 * Family settings, and the app's only route to the things Play expects an app to state about itself.
 *
 * Four switches and a number, each of which changes how the app behaves for every child in the
 * family — so each carries a line saying what it actually does rather than only its name. "Enable
 * leaderboard" tells a parent nothing about the child who always comes last.
 *
 * ## Saved on change, not behind a Save button
 *
 * Every field is independent and idempotent, and the endpoint takes a partial. A Save button would
 * add a step, a dirty state, and a way to lose changes by navigating away. The trade is that a failed
 * write must visibly revert — which it does, because the switch renders from the query and the query
 * is invalidated after every mutation, so a rejected change snaps back rather than lying.
 *
 * ## Why Support and About render outside the query's own success path
 *
 * The preferences need `GET /family/settings`. The privacy policy does not, and must not: a parent
 * who cannot load their settings because they are offline, signed into a broken session, or hitting a
 * 500 is exactly the parent most likely to be looking for the support address or the deletion steps.
 * Gating the legal links behind a successful family fetch would make them unreachable at the moment
 * they matter, so `FamilyPreferences` owns the query and its failure states while the sections below
 * it render unconditionally.
 *
 * ## Why these links live on a parent screen
 *
 * Everything here leaves the app, for an unfiltered browser or a mail client. Under Play's Families
 * policy that belongs behind the parent side of the app, which this whole route group already is, and
 * nowhere a child can reach.
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Application from 'expo-application';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { CardHeading } from '@/components/CardHeading';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { NetworkError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import {
  INVALIDATED_BY_FAMILY_WRITE,
  settingsQuery,
  updateSettings,
  type SettingsInput,
} from '@/lib/familyApi';
import {
  DELETE_ACCOUNT_URL,
  openFirstAvailable,
  playListingUrls,
  PRIVACY_URL,
  SUPPORT_EMAIL,
  supportMailto,
  TERMS_URL,
} from '@/lib/externalLinks';
import { fontSize, fontWeight, minTouchTarget, spacing, useTheme } from '@/theme';

function Toggle({
  label,
  detail,
  value,
  busy,
  onToggle,
}: {
  label: string;
  detail: string;
  value: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onToggle}
      disabled={busy}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: busy }}
      accessibilityLabel={`${label}. ${detail}`}
      style={styles.toggleRow}
    >
      <AppText style={[styles.mark, { color: value ? theme.primary : theme.border }]}>
        {value ? '☑' : '☐'}
      </AppText>
      <View style={styles.toggleText}>
        <AppText style={[styles.toggleLabel, { color: theme.cardForeground }]}>{label}</AppText>
        <AppText style={[styles.detail, { color: theme.mutedForeground }]}>{detail}</AppText>
      </View>
    </Pressable>
  );
}

/**
 * A row that hands the user to something outside the app.
 *
 * `link` rather than `button` because that is what it is, and the distinction is the one thing a
 * screen reader can use to warn that the next tap leaves TaskBuddy. The hint names where it goes for
 * the same reason: leaving the app unannounced is disorienting, and doubly so mid-task.
 */
function LinkRow({
  icon,
  label,
  detail,
  hint,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail: string;
  hint: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Ionicons
        name={icon}
        size={ICON_SIZE}
        color={theme.mutedForeground}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
      <View style={styles.toggleText}>
        <AppText style={[styles.toggleLabel, { color: theme.cardForeground }]}>{label}</AppText>
        <AppText style={[styles.detail, { color: theme.mutedForeground }]}>{detail}</AppText>
      </View>
      {/* Signals "this leaves the app" to everyone who is not using the screen reader hint above. */}
      <Ionicons
        name="open-outline"
        size={ICON_SIZE}
        color={theme.mutedForeground}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

function FamilyPreferences() {
  const theme = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [grace, setGrace] = useState<string | null>(null);

  const { data, error, isPending, isError, refetch } = useQuery(settingsQuery());
  const settings = data?.settings;

  const invalidate = useCallback(async () => {
    await Promise.all(
      INVALIDATED_BY_FAMILY_WRITE.map((key) => queryClient.invalidateQueries({ queryKey: key }))
    );
  }, [queryClient]);

  const { mutateAsync: save } = useMutation({ mutationFn: updateSettings });

  const apply = useCallback(
    async (input: SettingsInput) => {
      setBusy(true);
      try {
        await save(input);
        await invalidate();
      } catch (caught) {
        // The switch reverts on its own — it renders from the query, which the failure left
        // unchanged. The toast explains why it snapped back.
        toast.show(describeError(caught), 'error');
      } finally {
        setBusy(false);
      }
    },
    [save, invalidate, toast]
  );

  if (isPending) {
    return (
      <Card>
        <AppText style={[styles.detail, { color: theme.mutedForeground }]}>Loading…</AppText>
      </Card>
    );
  }

  if (isError || !settings) {
    const offline = error instanceof NetworkError;
    return (
      <Card>
        <AppText style={[styles.toggleLabel, { color: theme.destructive }]}>
          {offline ? 'No connection' : 'Could not load settings'}
        </AppText>
        <AppText style={[styles.detail, { color: theme.cardForeground }]}>
          {describeError(error)}
        </AppText>
        <View style={styles.action}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Card>
    );
  }

  const graceValue = grace ?? String(settings.streakGracePeriodHours ?? 0);
  const graceNumber = Number.parseInt(graceValue, 10);
  const graceValid = Number.isInteger(graceNumber) && graceNumber >= 0 && graceNumber <= 12;

  return (
    <>
      <Card>
        <Toggle
          label="Approve recurring tasks automatically"
          detail="Repeating tasks award points as soon as a child marks them done, without waiting for you."
          value={settings.autoApproveRecurringTasks}
          busy={busy}
          onToggle={() =>
            void apply({ autoApproveRecurringTasks: !settings.autoApproveRecurringTasks })
          }
        />
        <Toggle
          label="Daily challenges"
          detail="A small bonus goal each day, with extra points for finishing it."
          value={settings.enableDailyChallenges}
          busy={busy}
          onToggle={() => void apply({ enableDailyChallenges: !settings.enableDailyChallenges })}
        />
        <Toggle
          label="Family leaderboard"
          detail="Ranks your children against each other. Turning it off hides it from everyone — a reasonable choice if one child is always last."
          value={settings.enableLeaderboard}
          busy={busy}
          onToggle={() => void apply({ enableLeaderboard: !settings.enableLeaderboard })}
        />
      </Card>

      <Card>
        <AppText style={[styles.toggleLabel, { color: theme.cardForeground }]}>
          Streak grace period
        </AppText>
        <AppText style={[styles.detail, { color: theme.mutedForeground }]}>
          Hours after midnight a streak survives an unfinished day. 0 to 12.
        </AppText>
        <Field
          label="Hours"
          value={graceValue}
          onChangeText={(next) => setGrace(next.replace(/\D/g, ''))}
          keyboardType="number-pad"
          editable={!busy}
          hint={!graceValid ? 'Between 0 and 12' : undefined}
        />
        <Button
          label="Save grace period"
          variant="secondary"
          onPress={() => {
            if (graceValid) void apply({ streakGracePeriodHours: graceNumber });
          }}
          disabled={busy || !graceValid}
        />
      </Card>

      <Card>
        <AppText style={[styles.toggleLabel, { color: theme.cardForeground }]}>Co-parents</AppText>
        <AppText style={[styles.detail, { color: theme.mutedForeground }]}>
          Invite another adult, or manage who has access.
        </AppText>
        <View style={styles.action}>
          <Button
            label="Manage co-parents"
            variant="secondary"
            onPress={() => router.push('/(parent)/co-parents')}
          />
        </View>
      </Card>
    </>
  );
}

function SupportAndAbout() {
  const theme = useTheme();
  const toast = useToast();

  // All three are null in Expo Go and on the web, where there is no installed package to read. See
  // the note in VersionBadge.tsx for why these come from expo-application rather than the app config.
  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;
  const applicationId = Application.applicationId;

  const open = useCallback(
    (urls: string[], missing: string) => {
      void openFirstAvailable(urls).then((opened) => {
        if (!opened) toast.show(missing, 'error');
      });
    },
    [toast]
  );

  return (
    <>
      <Card>
        <CardHeading icon="help-buoy-outline" label="Support" />
        <LinkRow
          icon="mail-outline"
          label="Contact support"
          detail="Report a problem or suggest something. Your app version is filled in for you."
          hint="Opens your email app"
          onPress={() =>
            open(
              [supportMailto({ version, build, platform: 'Android' })],
              `No email app is set up on this device. Write to ${SUPPORT_EMAIL}.`
            )
          }
        />
        {/* Nothing to rate in Expo Go, where there is no installed package. Hidden rather than shown
            leading nowhere, the same call VersionBadge makes about a missing version. */}
        {applicationId !== null && (
          <LinkRow
            icon="star-outline"
            label="Rate TaskBuddy"
            detail="Leave a review on Google Play. It takes a minute and it genuinely helps."
            hint="Opens the Play Store"
            onPress={() =>
              open(playListingUrls(applicationId), 'Could not open the Play Store on this device.')
            }
          />
        )}
      </Card>

      <Card>
        <CardHeading icon="document-text-outline" label="About" />
        <LinkRow
          icon="lock-closed-outline"
          label="Privacy policy"
          detail="What we collect about you and your children, and why."
          hint="Opens in your browser"
          onPress={() => open([PRIVACY_URL], 'Could not open your browser.')}
        />
        <LinkRow
          icon="reader-outline"
          label="Terms of service"
          detail="The agreement covering your use of TaskBuddy."
          hint="Opens in your browser"
          onPress={() => open([TERMS_URL], 'Could not open your browser.')}
        />
        <LinkRow
          icon="trash-outline"
          label="Delete your account"
          detail="How to remove your family's account and everything in it."
          hint="Opens in your browser"
          onPress={() => open([DELETE_ACCOUNT_URL], 'Could not open your browser.')}
        />
        {version !== null && (
          <View style={styles.versionRow}>
            <AppText
              accessibilityRole="text"
              accessibilityLabel={`App version ${version}${build ? `, build ${build}` : ''}`}
              style={[styles.detail, { color: theme.mutedForeground }]}
            >
              Version {version}
              {build ? ` (${build})` : ''}
            </AppText>
          </View>
        )}
      </Card>
    </>
  );
}

export default function Settings() {
  const theme = useTheme();

  return (
    <Screen scroll>
      <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
        Family settings
      </AppText>

      <FamilyPreferences />
      <SupportAndAbout />

      <View style={styles.footer} />
    </Screen>
  );
}

/** Matches the 22dp reveal icon in Field.tsx; the 44dp target comes from the row, not the glyph. */
const ICON_SIZE = 22;

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[4],
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    minHeight: minTouchTarget,
    paddingVertical: spacing[2],
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: minTouchTarget,
    paddingVertical: spacing[2],
  },
  toggleText: { flex: 1 },
  mark: { fontSize: fontSize.lg.fontSize, marginTop: spacing[1] },
  toggleLabel: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  detail: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  action: { marginTop: spacing[3] },
  versionRow: { paddingTop: spacing[3] },
  footer: { height: spacing[8] },
});
