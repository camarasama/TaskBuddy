/**
 * Playing a quiz.
 *
 * One question at a time, answered irrevocably, with the correct answer revealed immediately after.
 *
 * ## Why answers are locked one at a time rather than collected and submitted together
 *
 * That is the server's design, and it is the right one: `POST /answer` commits the choice *before*
 * telling the client which option was correct, so `correctIndex` in the response cannot be used to
 * change the answer. A client that gathered all five and posted them at the end would have to receive
 * the answer key up front. The immediate right/wrong feedback children get is a consequence of that
 * safety property, not a separate feature.
 *
 * ## Two failure modes this screen is built around
 *
 * **A session must not be created twice.** `POST /games/sessions` expires any lingering in-progress
 * session for the game, so a double-mount would silently discard the first one's answers. The start is
 * therefore a mutation fired exactly once from an effect guarded by a ref, not a query — React Query
 * would happily retry it.
 *
 * **A half-answered quiz must survive a re-mount.** `GET /games/sessions/:id` returns `answeredCount`,
 * so re-entering with a session id resumes at the right question. It cannot survive the app being
 * killed, because the id lives in the route params — the same limitation the web has, where it lives in
 * the query string.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { GameQuestion } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { describeError } from '@/lib/errors';
import {
  answerQuestion,
  INVALIDATED_BY_GAME_SUBMIT,
  resumeSession,
  startSession,
  submitSession,
} from '@/lib/gamesApi';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

interface Loaded {
  sessionId: string;
  title: string;
  questions: GameQuestion[];
  /** Where the child had got to, for a resume. */
  answeredCount: number;
}

/** What the last answer revealed, cleared when moving on. */
interface Revealed {
  chosenIndex: number;
  correctIndex: number;
  correct: boolean;
}

export default function GamePlay() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ gameId?: string; session?: string }>();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Guards the one-shot start. A ref rather than state because the effect must not re-run when it
   * flips — and because two rapid mounts in development would otherwise create two sessions, the
   * second silently expiring the first.
   */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const resumeId = typeof params.session === 'string' ? params.session : null;
    const gameId = typeof params.gameId === 'string' ? params.gameId : null;

    void (async () => {
      try {
        if (resumeId) {
          const session = await resumeSession(resumeId);
          setLoaded({
            sessionId: session.sessionId,
            title: session.game.title,
            questions: session.questions,
            answeredCount: session.answeredCount,
          });
          setIndex(Math.min(session.answeredCount, session.questions.length - 1));
          return;
        }

        if (!gameId) {
          setError('No game chosen.');
          return;
        }

        const session = await startSession(gameId);
        setLoaded({
          sessionId: session.sessionId,
          title: session.game.title,
          questions: session.questions,
          answeredCount: 0,
        });
      } catch (caught) {
        // A cooldown that expired between the picker rendering and the child tapping arrives here as a
        // 409. Surfaced rather than retried — retrying would just fail again.
        setError(describeError(caught));
      }
    })();
  }, [params.gameId, params.session]);

  const onChoose = useCallback(
    async (answerIndex: number) => {
      if (!loaded || busy || revealed) return;
      setBusy(true);
      setError(null);
      try {
        const result = await answerQuestion(loaded.sessionId, index, answerIndex);
        setRevealed({
          chosenIndex: answerIndex,
          correctIndex: result.correctIndex,
          correct: result.correct,
        });
      } catch (caught) {
        setError(describeError(caught));
      } finally {
        setBusy(false);
      }
    },
    [loaded, busy, revealed, index]
  );

  const onNext = useCallback(async () => {
    if (!loaded) return;

    const isLast = index >= loaded.questions.length - 1;
    if (!isLast) {
      setIndex((i) => i + 1);
      setRevealed(null);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await submitSession(loaded.sessionId);
      await Promise.all(
        INVALIDATED_BY_GAME_SUBMIT.map((key) => queryClient.invalidateQueries({ queryKey: key }))
      );
      // Replace, not push: the finished quiz must not be reachable with the back gesture.
      router.replace({
        pathname: '/(child)/games/review',
        params: { session: loaded.sessionId },
      });
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }, [loaded, index, queryClient]);

  if (error !== null && loaded === null) {
    return (
      <Screen scroll>
        <Card>
          <AppText style={[styles.question, { color: theme.destructive }]}>
            Couldn&apos;t start the game
          </AppText>
          <AppText style={[styles.meta, { color: theme.cardForeground }]}>{error}</AppText>
        </Card>
        <View style={styles.footer}>
          <Button label="Go back" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  if (!loaded) {
    return (
      <Screen>
        <Card>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>Getting ready…</AppText>
        </Card>
      </Screen>
    );
  }

  const question = loaded.questions[index];
  const isLast = index >= loaded.questions.length - 1;

  return (
    <Screen>
      <ScrollView>
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
          {loaded.title} · Question {index + 1} of {loaded.questions.length}
        </AppText>

        <Card>
          <AppText style={[styles.question, { color: theme.cardForeground }]}>{question.text}</AppText>

          {question.options.map((option, optionIndex) => {
            // Colour AND a word. A child who cannot distinguish the two greens still learns the answer.
            const isCorrect = revealed !== null && optionIndex === revealed.correctIndex;
            const isWrongChoice =
              revealed !== null && optionIndex === revealed.chosenIndex && !revealed.correct;

            const borderColor = isCorrect
              ? theme.primary
              : isWrongChoice
                ? theme.destructive
                : theme.border;

            return (
              <View key={optionIndex} style={styles.optionWrap}>
                <Button
                  label={option}
                  variant="secondary"
                  onPress={() => void onChoose(optionIndex)}
                  disabled={busy || revealed !== null}
                />
                {(isCorrect || isWrongChoice) && (
                  <AppText
                    style={[styles.verdict, { color: isCorrect ? theme.primary : theme.destructive }]}
                  >
                    {isCorrect ? 'Correct answer' : 'Your answer'}
                  </AppText>
                )}
                <View style={[styles.optionRule, { backgroundColor: borderColor }]} />
              </View>
            );
          })}
        </Card>

        {error !== null && (
          <Card style={{ borderColor: theme.destructive, borderWidth: 1 }}>
            <AppText accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
              {error}
            </AppText>
          </Card>
        )}

        {revealed !== null && (
          <View style={styles.footer}>
            <AppText
              accessibilityRole="alert"
              style={[
                styles.verdictBig,
                { color: revealed.correct ? theme.primary : theme.destructive },
              ]}
            >
              {revealed.correct ? 'Nice one!' : 'Not this time.'}
            </AppText>
            <Button
              label={isLast ? 'Finish' : 'Next question'}
              onPress={() => void onNext()}
              busy={busy}
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginBottom: spacing[2] },
  question: {
    fontSize: fontSize.lg.fontSize,
    lineHeight: fontSize.lg.lineHeight,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[4],
  },
  optionWrap: { marginBottom: spacing[3], minHeight: minTouchTarget },
  optionRule: { height: 2, borderRadius: radius.full, marginTop: spacing[1] },
  verdict: { fontSize: fontSize.xs.fontSize, fontWeight: fontWeight.bold, marginTop: spacing[1] },
  verdictBig: {
    fontSize: fontSize.xl.fontSize,
    lineHeight: fontSize.xl.lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[3],
    textAlign: 'center',
  },
  footer: { marginTop: spacing[4], marginBottom: spacing[6] },
});
