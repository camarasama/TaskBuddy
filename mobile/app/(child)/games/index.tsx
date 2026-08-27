/**
 * Game picker: the category × level grid.
 *
 * Six categories down, three levels across. Every category is drawn from the shared constants rather
 * than from the payload, so one with no authored content shows as an explicitly empty row instead of
 * silently vanishing: a content gap is worth seeing, a category that disappears reads as a bug.
 *
 * ## Colour is the navigation here, not decoration
 *
 * This is the one screen in the app whose entire audience is children, and the first version of it was
 * six identical dark cards of outlined cells, correct and indistinguishable from a settings list. The
 * rework gives every subject a fixed identity (its emoji and its own tinted banner, so Maths is found by
 * looking rather than by reading) and every level a fixed colour that is the *same colour on the web*:
 * green beginner, amber intermediate, purple hard. A child who learns "purple is the hard one" on one
 * client is not re-taught it on the other.
 *
 * Every tint is a `100` background under `700` text from the same ramp, the pair the redesign spec
 * fixes for surfaces that must read identically in light and dark mode, and the same pair `StatTile`
 * and `Chip` already use. That is why these bands stay bright on a slate-900 screen instead of dimming
 * with it: a subject's colour is its name, and a name does not change with the OS appearance setting.
 *
 * ## Cooldown is a row, not a cell
 *
 * Completing any maths game holds *every* maths game. Saying so once per row ("back in 3h" beside the
 * category name) is both accurate and less alarming than three greyed cells with no explanation. The
 * flag comes from the server; nothing here recomputes it from timestamps.
 *
 * Level is freely selectable at any age by design. Appropriateness lives in the authored questions, not
 * in a gate on the picker, so a confident nine-year-old can play `hard` and a struggling teenager can
 * play `beginner` without either being told they may not.
 */
// From the family's own module, never the `@expo/vector-icons` barrel: the barrel bundles all 20 icon
// fonts on an app whose audience is families with cheap phones and metered data.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import {
  GAME_CATEGORY_EMOJI,
  GAME_CATEGORY_LABELS,
  GAME_LEVEL_LABELS,
  GAME_LEVEL_SHORT_LABELS,
  GAME_REWARDS,
  type GameCategory,
  type GameDefinition,
  type GameLevel,
} from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { cooldownLabel, gamesQuery, groupByCategory, type CategoryGroup } from '@/lib/gamesApi';
import {
  elevation,
  fontSize,
  fontWeight,
  minTouchTarget,
  onGradient,
  palette,
  radius,
  spacing,
  useTheme,
} from '@/theme';

/**
 * A tint pair: the `100` fill and the `700` ink from one ramp.
 *
 * Written as a pair rather than as a ramp name so the two can never be taken from different steps by
 * accident, since the whole contrast argument above depends on them staying 100 and 700.
 */
interface Tint {
  fill: string;
  ink: string;
}

/**
 * Each subject's colour. Six ramps for six categories, chosen to be distinguishable by hue alone at a
 * glance, which is the only way the banner does its job for a child who is scrolling rather than
 * reading.
 *
 * `destructive` appears here as a plain coral, not as an error signal: at the `100`/`700` pair it is a
 * warm red band with an emoji on it, and nothing else on this screen uses red for failure, so there is
 * no meaning to collide with. The alternative was a second amber, which would have made Grammar and
 * Vocabulary the same card.
 */
const CATEGORY_TINT: Record<GameCategory, Tint> = {
  maths: { fill: palette.xp[100], ink: palette.xp[700] },
  science: { fill: palette.success[100], ink: palette.success[700] },
  geography: { fill: palette.primary[100], ink: palette.primary[700] },
  vocabulary: { fill: palette.peach[100], ink: palette.peach[700] },
  grammar: { fill: palette.destructive[100], ink: palette.destructive[700] },
  puzzle: { fill: palette.gold[100], ink: palette.gold[700] },
};

/**
 * Each level's colour, matching the web lobby's badges exactly (`LEVEL_STYLE` in
 * `frontend/src/app/child/games/page.tsx`). Deliberately not per-category: the level colours mean
 * "how hard", and a meaning that changed shade every row would mean nothing at all.
 */
const LEVEL_TINT: Record<GameLevel, Tint> = {
  beginner: { fill: palette.success[100], ink: palette.success[700] },
  intermediate: { fill: palette.warning[100], ink: palette.warning[700] },
  hard: { fill: palette.xp[100], ink: palette.xp[700] },
};

/** Points are gold and XP is purple everywhere else in the app; the picker does not invent its own. */
const POINTS_INK = palette.gold[700];
const XP_INK = palette.xp[700];

/**
 * Today's featured pick, per the redesign brief: one gradient CTA above the grid. There is no server
 * concept of a "pick of the day", so this rotates deterministically through whatever is playable right
 * now (not on cooldown, has an authored game), keyed by the day so it holds steady all day and changes
 * tomorrow. Returns null when nothing is playable, rather than featuring a locked cell.
 */
function pickTodaysGame(groups: CategoryGroup[]): { category: CategoryGroup['category']; game: GameDefinition } | null {
  const playable = groups
    .filter((g) => !g.onCooldown)
    .flatMap((g) => g.levels.flatMap((cell) => (cell.game ? [{ category: g.category, game: cell.game }] : [])));
  if (playable.length === 0) return null;

  const dayIndex = Math.floor(Date.now() / 86_400_000);
  return playable[dayIndex % playable.length];
}

/** Points and XP on one line, iconed rather than spelled out: three columns have no room for "pts". */
function RewardLine({ level, muted }: { level: GameLevel; muted?: string }) {
  const reward = GAME_REWARDS[level];
  const points = muted ?? POINTS_INK;
  const xp = muted ?? XP_INK;

  return (
    // Hidden from the accessibility tree, not labelled: the tile that contains this is itself one
    // accessible element and already says "2 points and 15 XP" in its own label. A labelled node
    // inside an accessible parent is either announced twice or steals the parent's focus stop,
    // depending on the platform, and a bare star glyph reads as nothing useful either way.
    <View style={styles.rewardRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ionicons name="star" size={12} color={points} />
      <AppText style={[styles.rewardValue, { color: points }]}>{reward.points}</AppText>
      <Ionicons name="flash" size={12} color={xp} />
      <AppText style={[styles.rewardValue, { color: xp }]}>{reward.xp}</AppText>
    </View>
  );
}

/**
 * The gradient CTA. Fixed brand surface, not a themed one, on the same reasoning as the child dashboard's
 * hero and wallet, and the same gradient, so the two screens read as the same app.
 */
function TodaysPick({ category, game, onPlay }: {
  category: CategoryGroup['category'];
  game: GameDefinition;
  onPlay: (game: GameDefinition) => void;
}) {
  const reward = GAME_REWARDS[game.level];
  const label = `${GAME_CATEGORY_LABELS[category]} ${GAME_LEVEL_LABELS[game.level]}`;

  return (
    <View style={[styles.pickOuter, elevation.lift]}>
      {/* {0,0}->{1,1} approximates CSS's 135deg (top-left to bottom-right). */}
      <LinearGradient
        colors={[palette.xp[600], palette.xp[500], palette.primary[500]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.pickGradient}
      >
        <View style={styles.pickRow}>
          {/* Solid white rather than a translucent wash: the emoji has to stay legible on whichever
              part of the gradient it lands on, and it reads as a sticker stuck to the card. */}
          <View style={[styles.pickBadge, { backgroundColor: onGradient }]}>
            <AppText style={styles.pickEmoji}>{GAME_CATEGORY_EMOJI[category]}</AppText>
          </View>
          <View style={styles.pickText}>
            <AppText style={[styles.pickLabel, { color: onGradient }]}>Today&apos;s pick</AppText>
            <AppText variant="display" style={[styles.pickTitle, { color: onGradient }]}>
              {label}
            </AppText>
            <AppText style={[styles.pickReward, { color: onGradient }]}>
              {reward.points} pts · {reward.xp} XP
            </AppText>
          </View>
        </View>

        {/*
          A white pill rather than `Button variant="secondary"`, which resolves to `theme.secondary`:
          slate-700 in dark mode, i.e. a grey slab in the middle of a purple card, and the single
          drabbest thing on the old screen. On a fixed brand gradient the CTA has to be a fixed colour
          too, for the same reason `onGradient` exists.
        */}
        <Pressable
          onPress={() => onPlay(game)}
          accessibilityRole="button"
          accessibilityLabel={`Play now: ${label}`}
          style={({ pressed }) => [
            styles.pickCta,
            { backgroundColor: onGradient, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Ionicons name="play" size={18} color={palette.xp[700]} />
          <AppText style={[styles.pickCtaLabel, { color: palette.xp[700] }]}>Play now</AppText>
        </Pressable>
      </LinearGradient>
    </View>
  );
}

function LevelTile({
  game,
  level,
  locked,
  category,
  onPlay,
}: {
  game: GameDefinition | null;
  level: GameLevel;
  locked: boolean;
  category: GameCategory;
  onPlay: (game: GameDefinition) => void;
}) {
  const theme = useTheme();
  const tint = LEVEL_TINT[level];

  /*
    The short label, because three columns on a phone is the one box in the app that cannot hold
    "Intermediate": measured against Inter at the token size it overflows a 360dp tile by 6.8dp, and
    on a 320dp screen it does not fit even at the 0.75 minimum font scale, so the word would be
    clipped on exactly the devices least able to spare the pixels.

    `adjustsFontSizeToFit` stays as the second line of defence rather than being dropped now the text
    is short. Text scales with the system font-size setting, and a family that has turned it up is not
    a rare case in an app aimed at children and grandparents.

    The full name is not lost: the tile's own accessibility label below reads "Intermediate", and the
    today's-pick card, the review screen and the web all still spell it out.
  */
  const levelLabel = (color: string) => (
    <AppText
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.75}
      style={[styles.tileLevel, { color }]}
    >
      {GAME_LEVEL_SHORT_LABELS[level]}
    </AppText>
  );

  // No authored game at this combination. Shown rather than hidden so the grid stays a grid: three
  // cells that sometimes become two make the row jump between categories.
  if (!game) {
    return (
      <View style={[styles.tile, { backgroundColor: theme.muted }]}>
        {levelLabel(theme.mutedForeground)}
        <AppText style={[styles.tileNote, { color: theme.mutedForeground }]}>Soon</AppText>
      </View>
    );
  }

  if (locked) {
    return (
      <View
        style={[styles.tile, { backgroundColor: theme.muted }]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={
          `${GAME_CATEGORY_LABELS[category]} ${GAME_LEVEL_LABELS[level]} is resting, ` +
          `worth ${GAME_REWARDS[level].points} points and ${GAME_REWARDS[level].xp} XP`
        }
      >
        {levelLabel(theme.mutedForeground)}
        {/* The reward stays visible, greyed. A locked level still has to advertise what it is worth,
            or the wait looks like it buys nothing. */}
        <RewardLine level={level} muted={theme.mutedForeground} />
        <View style={[styles.tileGo, { backgroundColor: theme.mutedForeground }]}>
          <Ionicons name="lock-closed" size={14} color={theme.muted} />
        </View>
      </View>
    );
  }

  return (
    // The whole tile is the button. The old cell nested a `Button` inside a bordered box, which spent
    // a third of a 110dp-wide cell on a target that was smaller than the thing containing it.
    <Pressable
      onPress={() => onPlay(game)}
      accessibilityRole="button"
      accessibilityLabel={
        `Play ${GAME_CATEGORY_LABELS[category]} ${GAME_LEVEL_LABELS[level]}, ` +
        `${GAME_REWARDS[level].points} points and ${GAME_REWARDS[level].xp} XP`
      }
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: tint.fill, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {levelLabel(tint.ink)}
      <RewardLine level={level} />
      <View style={[styles.tileGo, { backgroundColor: tint.ink }]}>
        <Ionicons name="play" size={14} color={tint.fill} />
      </View>
    </Pressable>
  );
}

function CategoryRow({
  group,
  onPlay,
}: {
  group: CategoryGroup;
  onPlay: (game: GameDefinition) => void;
}) {
  const tint = CATEGORY_TINT[group.category];
  const back = cooldownLabel(group.cooldownEndsAt);

  return (
    <Card>
      {/* The subject's banner: its emoji, its name and its colour, all fixed for the life of the app so
          the row is recognised before it is read. */}
      <View style={[styles.banner, { backgroundColor: tint.fill }]}>
        <AppText style={styles.bannerEmoji}>{GAME_CATEGORY_EMOJI[group.category]}</AppText>
        <AppText variant="display" style={[styles.bannerName, { color: tint.ink }]}>
          {GAME_CATEGORY_LABELS[group.category]}
        </AppText>
        {group.onCooldown && (
          // Stated in words, once, for the whole row. Three greyed cells with no reason is the most
          // common way a rules-heavy grid reads as broken.
          <View style={styles.bannerRest}>
            <Ionicons name="time-outline" size={14} color={tint.ink} />
            <AppText style={[styles.bannerRestLabel, { color: tint.ink }]}>
              {back ?? 'resting'}
            </AppText>
          </View>
        )}
      </View>

      <View style={styles.tileRow}>
        {group.levels.map((cell) => (
          <LevelTile
            key={cell.level}
            game={cell.game}
            level={cell.level}
            category={group.category}
            locked={group.onCooldown}
            onPlay={onPlay}
          />
        ))}
      </View>
    </Card>
  );
}

export default function GamePicker() {
  const theme = useTheme();
  const { data, error, isPending, isError, refetch } = useQuery(gamesQuery());
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  /**
   * Launch straight into play with the game id.
   *
   * The session is created on the play screen rather than here, so a mis-tap that immediately backs out
   * does not burn a session, and creating one expires any previous in-progress session for that game.
   */
  const onPlay = useCallback((game: GameDefinition) => {
    router.push({ pathname: '/(child)/games/play', params: { gameId: game.id } });
  }, []);

  if (isPending) {
    return (
      <Screen>
        <Card>
          <AppText style={[styles.subtitle, { color: theme.mutedForeground }]}>Loading games…</AppText>
        </Card>
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <Card>
          <AppText style={[styles.bannerName, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load games'}
          </AppText>
          <AppText style={[styles.subtitle, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <View style={styles.footer}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  const groups = groupByCategory(data.games);
  const todaysPick = pickTodaysGame(groups);

  return (
    <Screen>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
      >
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
          Play a game
        </AppText>
        <AppText style={[styles.subtitle, { color: theme.mutedForeground }]}>
          Pick a subject, then how hard you want it
        </AppText>

        {todaysPick && (
          <TodaysPick category={todaysPick.category} game={todaysPick.game} onPlay={onPlay} />
        )}

        {groups.map((group) => (
          <CategoryRow key={group.category} group={group} onPlay={onPlay} />
        ))}

        <View style={styles.footer}>
          <Button
            label="Past games"
            variant="secondary"
            onPress={() => router.push('/(child)/games/history')}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginBottom: spacing[4],
  },

  // ── Today's pick ───────────────────────────────────────────────────────────
  pickOuter: { borderRadius: radius.xl, marginBottom: spacing[4] },
  pickGradient: { borderRadius: radius.xl, padding: spacing[5] },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  pickBadge: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // No lineHeight: an emoji sized against a line box gets clipped at the top on Android.
  pickEmoji: { fontSize: 30 },
  pickText: { flex: 1 },
  pickLabel: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  pickTitle: {
    fontSize: fontSize.xl.fontSize,
    lineHeight: fontSize.xl.lineHeight,
    fontWeight: fontWeight.bold,
  },
  pickReward: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  pickCta: {
    marginTop: spacing[4],
    minHeight: minTouchTarget,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  pickCtaLabel: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.bold,
  },

  // ── Category banner ────────────────────────────────────────────────────────
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: radius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginBottom: spacing[3],
  },
  bannerEmoji: { fontSize: 24 },
  bannerName: {
    flex: 1,
    fontSize: fontSize.lg.fontSize,
    lineHeight: fontSize.lg.lineHeight,
    fontWeight: fontWeight.bold,
  },
  bannerRest: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  bannerRestLabel: { fontSize: fontSize.xs.fontSize, fontWeight: fontWeight.semibold },

  // ── Level tiles ────────────────────────────────────────────────────────────
  tileRow: { flexDirection: 'row', gap: spacing[2] },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    // spacing[1], not spacing[2]. The three columns are the tightest box in the app and the side
    // padding comes straight off the level label's width. The short labels alone would fit at 8 per
    // side, but the two together are what leave headroom for a family running a large system font
    // scale, which is the case that pins the label against the tile edge. The content is centred and
    // the tile is a solid colour block, so the narrower gutter costs nothing to look at.
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[3],
    gap: spacing[2],
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tileLevel: {
    // `alignSelf: 'stretch'` is load-bearing, not cosmetic: the tile centres its children, which leaves
    // a Text sized to its own content, and `adjustsFontSizeToFit` has nothing to shrink against when
    // the box grows with the words. Stretched to the tile's width, "Intermediate" shrinks to fit three
    // columns on a 360dp phone instead of being ellipsised.
    alignSelf: 'stretch',
    fontSize: fontSize.sm.fontSize,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  tileNote: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight },
  // The round "go" affordance. Deliberately not a nested Button: the tile is already the target, and a
  // second one inside it would give a child two things to hit for one action.
  tileGo: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  rewardValue: { fontSize: fontSize.xs.fontSize, fontWeight: fontWeight.bold },

  footer: { marginTop: spacing[4], marginBottom: spacing[6] },
});
