/**
 * Post-game review.
 *
 * Serves two arrivals with one renderer: straight off the end of a quiz, and from the history list days
 * later. `GET /games/history/:id` returns the same `review` array the submit response does, and the
 * option order is derived from the session id — so a child looking a game up later sees the layout they
 * actually played rather than a freshly shuffled one that makes their answer look arbitrary.
 *
 * ## Reporting what was paid, not what was advertised
 *
 * Points are awarded at most once per category per day; later plays that day earn XP only. So the
 * headline reads `pointsAwarded` from the server, never the level's face value from `GAME_REWARDS`, and
 * surfaces `cappedMessage` when there is one. A screen that promised 4 points and delivered 0 without
 * explanation is how an economy rule reads as the app cheating.
 */
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { GAME_CATEGORY_LABELS, GAME_LEVEL_LABELS, type GameQuestionReview } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Celebration } from '@/components/Celebration';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { reviewQuery } from '@/lib/gamesApi';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

function QuestionReview({ item, number }: { item: GameQuestionReview; number: number }) {
  const theme = useTheme();

  return (
    <Card>
      <AppText style={[styles.qNumber, { color: theme.mutedForeground }]}>
        Question {number} · {item.correct ? 'Right' : 'Wrong'}
      </AppText>
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

        return (
          <AppText
            key={optionIndex}
            style={[
              styles.option,
              {
                color: isCorrect
                  ? theme.primary
                  : isChoice
                    ? theme.destructive
                    : theme.mutedForeground,
              },
            ]}
          >
            {option}
            {tag ? ` — ${tag}` : ''}
          </AppText>
        );
      })}

      {item.chosenIndex === null && (
        <AppText style={[styles.option, { color: theme.mutedForeground }]}>
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
        <AppText variant="display" style={[styles.score, { color: theme.foreground }]}>
          {data.correctCount} out of {data.totalQuestions}
        </AppText>
        <AppText style={[styles.qNumber, { color: theme.mutedForeground }]}>
          {GAME_CATEGORY_LABELS[data.game.category]} · {GAME_LEVEL_LABELS[data.game.level]} ·{' '}
          {accuracy}%
        </AppText>

        <Card>
          {/* What the server actually paid, never the level's advertised value. */}
          <AppText style={[styles.qText, { color: theme.cardForeground }]}>
            {data.pointsAwarded > 0
              ? `You earned ${data.pointsAwarded} points and ${data.xpAwarded} XP.`
              : data.xpAwarded > 0
                ? `You earned ${data.xpAwarded} XP.`
                : 'No points this time — get more than half right to earn.'}
          </AppText>
        </Card>

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
  score: {
    fontSize: fontSize['3xl'].fontSize,
    lineHeight: fontSize['3xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  qNumber: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginBottom: spacing[2] },
  qText: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.medium,
    marginBottom: spacing[2],
  },
  option: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  footer: { marginTop: spacing[4], marginBottom: spacing[6] },
});
