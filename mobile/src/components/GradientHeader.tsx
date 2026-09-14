/**
 * The colourful band at the top of a child screen.
 *
 * Home and Games opened on a gradient; every other child screen opened on a bare heading, which is most
 * of why the app read as two different products. This is the same masthead as the home hero, made
 * reusable, so each screen states what it is in the same visual voice.
 *
 * Same two-view construction as `Card` and the home hero: the shadow lives on the outer view and the
 * clipping on the inner one, or Android draws a square shadow under a rounded band.
 *
 * The tone decides the colours and nothing else; see `theme/accents.ts` for the contrast each tone was
 * checked against. Text is never given reduced opacity, which would quietly undo those numbers.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IoniconName } from '@/components/IconTile';
import { elevation, fontSize, fontWeight, onGradient, radius, spacing } from '@/theme';
import { GRADIENT, type GradientTone } from '@/theme/accents';

interface GradientHeaderProps {
  tone: GradientTone;
  title: string;
  /** Small uppercase line above the title: what the screen is ("Your tasks"), when the title is a value. */
  eyebrow?: string;
  subtitle?: string;
  /** Shown in the white badge. Wins over `icon`. */
  emoji?: string;
  icon?: IoniconName;
  /** Replaces the badge entirely, for the Me hub's avatar. */
  badge?: ReactNode;
  /** Rendered under the text: a progress bar or a row of chips. */
  children?: ReactNode;
}

export function GradientHeader({
  tone,
  title,
  eyebrow,
  subtitle,
  emoji,
  icon,
  badge,
  children,
}: GradientHeaderProps) {
  const spec = GRADIENT[tone];
  const hasBadge = Boolean(badge || emoji || icon);

  return (
    <View style={[styles.outer, elevation.lift]}>
      {/* {0,0}->{1,1} approximates CSS's 135deg, the direction the web's gradients run. */}
      <LinearGradient colors={spec.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
        <View
          style={styles.circle}
          pointerEvents="none"
          importantForAccessibility="no"
          accessibilityElementsHidden
        />
        <View style={styles.row}>
          {hasBadge && (
            <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              {badge ?? (
                // Solid white, so the glyph stays legible wherever on the gradient it lands.
                <View style={[styles.badge, { backgroundColor: onGradient }]}>
                  {emoji ? (
                    <AppText style={styles.badgeEmoji}>{emoji}</AppText>
                  ) : (
                    <Ionicons name={icon as IoniconName} size={26} color={spec.badgeInk} />
                  )}
                </View>
              )}
            </View>
          )}
          <View style={styles.text}>
            {eyebrow ? (
              <AppText style={[styles.eyebrow, { color: spec.ink }]} numberOfLines={1}>
                {eyebrow}
              </AppText>
            ) : null}
            <AppText
              variant="display"
              accessibilityRole="header"
              style={[styles.title, { color: spec.ink }]}
              numberOfLines={2}
            >
              {title}
            </AppText>
            {subtitle ? (
              <AppText style={[styles.subtitle, { color: spec.ink }]}>{subtitle}</AppText>
            ) : null}
          </View>
        </View>
        {children ? <View style={styles.extra}>{children}</View> : null}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { borderRadius: radius.xl, marginBottom: spacing[4] },
  gradient: { borderRadius: radius.xl, overflow: 'hidden', padding: spacing[5] },
  circle: {
    position: 'absolute',
    top: -60,
    right: -50,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: onGradient,
    opacity: 0.15,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  badge: { width: 52, height: 52, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  badgeEmoji: { fontSize: 28 },
  text: { flex: 1 },
  eyebrow: {
    fontSize: fontSize.xs.fontSize,
    lineHeight: fontSize.xs.lineHeight,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: fontSize.xl.fontSize,
    lineHeight: fontSize.xl.lineHeight,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.semibold,
    marginTop: spacing[1],
  },
  extra: { marginTop: spacing[4] },
});
