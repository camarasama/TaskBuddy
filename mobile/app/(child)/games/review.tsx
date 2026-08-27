/**
 * Post-game review.
 *
 * Serves two arrivals with one renderer: straight off the end of a quiz, and from the history list days
 * later. `GET /games/history/:id` returns the same `review` array the submit response does, and the
 * option order is derived from the session id, so a child looking a game up later sees the layout they
 * actually played rather than a freshly shuffled one that makes their answer look arbitrary.
 *
 * ## Reporting what was paid, not what was advertised
 *
 * Points are awarded at most once per category per day; later plays that day earn XP only. So the
 * headline reads `pointsAwarded` from the server, never the level's face value from `GAME_REWARDS`, and
 * surfaces `cappedMessage` when there is one. A screen that promised 4 points and delivered 0 without
 * explanation is how an economy rule reads as the app cheating.
 */
// From the family's own module, never the `@expo/vector-icons` barrel: the barrel bundles all 20 icon
// fonts on an app whose audience is families with cheap phones and metered data.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import {
  GAME_CATEGORY_EMOJI,
  GAME_CATEGORY_LABELS,
  GAME_LEVEL_LABELS,
  type GameQuestionReview,
} from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Celebration } from '@/components/Celebration';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { reviewQuery } from '@/lib/gamesApi';
import {
  elevation,
  fontSize,
  fontWeight,
  onGradient,
  palette,
  radius,
  spacing,
  useTheme,
} from '@/theme';

/**
 * The same right/wrong tints the play screen answers with, so a question looks the same colour weeks
 * later as it did the moment it was answered. `100` fill under `700` ink is the pair the app fixes for
 * surfaces that must hold up in both light and dark mode (see `StatTile`).
 */
const RIGHT = { fill: palette.success[100], ink: palette.success[700] };
const WRONG = { fill: palette.destructive[100], ink: palette.destructive[700] };

function QuestionReview({ item, number }: { item: GameQuestionReview; number: number }) {
  const theme = useTheme();
  const verdict = item.correct ? RIGHT : WRONG;

  return (
    // The stripe repeats the verdict on the card's edge, so a scroll back through ten questions shows
    // which ones went wrong without any of them being read.
    <Card status={item.correct ? 'done' : 'late'}>
      <View style={styles.qHeader}>
        <View style={[styles.qBadge, { backgroundColor: verdict.fill }]}>
          <Ionicons
            name={item.correct ? 'checkmark' : 'close'}
            size={14}
            color={verdict.ink}
          />
        </View>
        <AppText style={[styles.qNumber, { color: theme.mutedForeground }]}>
          Question {number} · {item.correct ? 'Right' : 'Wrong'}
        </AppText>
      </View>

      <AppText style={[styles.qText, { color: theme.cardForeground }]}>{item.text}</AppText>

      {item.options.map((option, optionIndex) => {
        const isCorrect = optionIndex === item.correctIndex;
        const isChoice = optionIndex === item.chosenIndex;

        // Every state is labelled in words. Reading this back weeks later, colour alone would not tell
        // a child which one they picked.
        const tag = isCorrect && isChoice
          ? 'you got it'
          : isCorrect
            ? 'right answer'
            : isChoice
              ? 'you picked this'
              : null;

        const tint = isCorrect ? RIGHT : isChoice ? WRONG : null;
        // Options that were neither picked nor correct stay on the plain surface: filling all four
        // would bury the two that carry the lesson.
        const fill = tint ? tint.fill : theme.muted;
        const ink = tint ? tint.ink : theme.mutedForeground;

        return (
          <View key={optionIndex} style={[styles.option, { backgroundColor: fill }]}>
            <AppText style={[styles.optionText, { color: ink }]}>{option}</AppText>
            {tag && <AppText style={[styles.optionTag, { color: ink }]}>{tag}</AppText>}
          </View>
        );
      })}

      {item.chosenIndex === null && (
        <AppText style={[styles.optionTag, { color: theme.mutedForeground }]}>
          You didn&apos;t answer this one.
        </AppText>
      )}
    </Card>
  );
}

export default function GameReview() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ session?: string }>();
  const sessionId = typeof params.session === 'string' ? params.session : '';

  const { data, error, isPending, isError, refetch } = useQuery({
    ...reviewQuery(sessionId),
    enabled: sessionId.length > 0,
  });

  const accuracy = useMemo(() => {
    if (!data || data.totalQuestions === 0) return 0;
    return Math.round((data.correctCount / data.totalQuestions) * 100);
  }, [data]);

  /**
   * Celebrate only what was actually paid, and only when something was.
   *
   * A game below the accuracy floor earns nothing, and one played a second time in the same category
   * today earns XP but no points. Congratulating either would be the app telling a child they gained
   * something the balance will not show.
   */
  const [celebrated, setCelebrated] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);

  useEffect(() => {
    if (celebrated || !data) return;
    if (data.pointsAwarded > 0 || data.xpAwarded > 0) {
      setShowCelebration(true);
    }
    setCelebrated(true);
  }, [data, celebrated]);

  if (!sessionId) {
    return (
      <Screen>
        <Card>
          <AppText style={[styles.qText, { color: theme.destructive }]}>No game to show.</AppText>
        </Card>
        <View style={styles.footer}>
          <Button label="Back to games" onPress={() => router.replace('/(child)/games')} />
        </View>
      </Screen>
    );
  }

  if (isPending) {
    return (
      <Screen>
        <Card>
          <AppText style={[styles.qNumber, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <Card>
          <AppText style={[styles.qText, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load that game'}
          </AppText>
          <AppText style={[styles.qNumber, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <View style={styles.footer}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView>
        {/*
          The scoreboard: one fixed brand gradient carrying the score, the subject and what was actually
          paid. Fixed rather than themed for the same reason as the dashboard hero and the picker's
          today's-pick card, and it is the same gradient, so a child finishing a game lands on something
          that plainly belongs to the same app.
        */}
        <View style={[styles.scoreOuter, elevation.lift]}>
          <LinearGradient
            colors={[palette.xp[600], palette.xp[500], palette.primary[500]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.scoreGradient}
          >
            <View style={styles.scoreRow}>
              <View style={[styles.scoreBadge, { backgroundColor: onGradient }]}>
                <AppText style={styles.scoreEmoji}>
                  {GAME_CATEGORY_EMOJI[data.game.category]}
                </AppText>
              </View>
              <View style={styles.scoreText}>
                <AppText variant="display" style={[styles.score, { color: onGradient }]}>
                  {data.correctCount} out of {data.totalQuestions}
                </AppText>
                <AppText style={[styles.scoreMeta, { color: onGradient }]}>
                  {GAME_CATEGORY_LABELS[data.game.category]} ·{' '}
                  {GAME_LEVEL_LABELS[data.game.level]} · {accuracy}%
                </AppText>
              </View>
            </View>

            {/* What the server actually paid, never the level's advertised value. */}
            <View style={[styles.earned, { backgroundColor: onGradient }]}>
              {data.pointsAwarded > 0 && (
                <View style={styles.earnedItem}>
                  <Ionicons name="star" size={16} color={palette.gold[700]} />
                  <AppText style={[styles.earnedValue, { color: palette.gold[700] }]}>
                    +{data.pointsAwarded} pts
                  </AppText>
                </View>
              )}
              {data.xpAwarded > 0 && (
                <View style={styles.earnedItem}>
                  <Ionicons name="flash" size={16} color={palette.xp[700]} />
                  <AppText style={[styles.earnedValue, { color: palette.xp[700] }]}>
                    +{data.xpAwarded} XP
                  </AppText>
                </View>
              )}
              {data.pointsAwarded === 0 && data.xpAwarded === 0 && (
                <AppText style={[styles.earnedValue, { color: palette.slate[600] }]}>
                  No points this time, get more than half right to earn
                </AppText>
              )}
            </View>
          </LinearGradient>
        </View>

        {data.review.map((item, i) => (
          <QuestionReview key={item.questionIndex} item={item} number={i + 1} />
        ))}

        <View style={styles.footer}>
          <Button label="Back to games" onPress={() => router.replace('/(child)/games')} />
        </View>
      </ScrollView>

      {showCelebration && (
        <Celebration
          message={data.correctCount === data.totalQuestions ? 'Perfect!' : 'Well played!'}
          detail={
            data.pointsAwarded > 0
              ? `+${data.pointsAwarded} points · +${data.xpAwarded} XP`
              : `+${data.xpAwarded} XP`
          }
          onDone={() => setShowCelebration(false)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scoreOuter: { borderRadius: radius.xl, marginBottom: spacing[4] },
  scoreGradient: { borderRadius: radius.xl, padding: spacing[5] },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  scoreBadge: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // No lineHeight: an emoji sized against a line box gets clipped at the top on Android.
  scoreEmoji: { fontSize: 30 },
  scoreText: { flex: 1 },
  score: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  scoreMeta: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  earned: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    borderRadius: radius.lg,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    marginTop: spacing[4],
  },
  earnedItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  earnedValue: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },

  qHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  qBadge: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qNumber: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginBottom: spacing[2] },
  qText: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.medium,
    marginBottom: spacing[2],
  },
  option: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginTop: spacing[1],
  },
  optionText: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.medium,
  },
  optionTag: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight, fontWeight: fontWeight.bold },
  footer: { marginTop: spacing[4], marginBottom: spacing[6] },
});
