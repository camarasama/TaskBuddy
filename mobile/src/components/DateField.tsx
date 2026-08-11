/**
 * A date of birth field backed by the OS date picker.
 *
 * ## Why this replaced a text box
 *
 * Both DOB inputs were free text with a `YYYY-MM-DD` placeholder. That asks a parent to type a
 * format, which is the one thing a phone is worst at and a date picker is for. It also produced the
 * failure this component exists to end: a valid-looking entry rejected only after pressing submit,
 * because the string parsed but the age did not qualify.
 *
 * ## Two formats, deliberately, and they must not be confused
 *
 * - **Displayed: DD/MM/YYYY.** What the audience reads. `toLocaleDateString` is NOT used, because it
 *   follows the device locale and would render US order on a US phone, which is exactly the
 *   ambiguity a fixed format is meant to remove.
 * - **Emitted: ISO `YYYY-MM-DD`.** What every schema on the server parses, and what
 *   `isAgeBetween` expects. The value handed to `onChange` is always ISO regardless of what is on
 *   screen.
 *
 * ## Bounds come from the caller, not from here
 *
 * `minimumDate` / `maximumDate` stop an out-of-range date being *picked* at all, which is better
 * than validating it afterwards. They are passed in rather than derived, because the child rule and
 * the adult rule are different and this component should not know which one it is serving.
 */
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { AppText } from './AppText';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

interface DateFieldProps {
  label: string;
  /** ISO `YYYY-MM-DD`, or '' when nothing is chosen yet. */
  value: string;
  /** Always called with ISO `YYYY-MM-DD`. */
  onChange: (isoDate: string) => void;
  hint?: string;
  error?: string;
  editable?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
}

/** ISO to DD/MM/YYYY. Locale-independent on purpose: see the note above. */
export function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

/**
 * Date to ISO, built from LOCAL parts.
 *
 * `toISOString()` would be wrong here and wrong in a way that only shows up for some users: it
 * converts to UTC first, so a date picked as the 1st in a timezone behind UTC serialises as the last
 * day of the previous month. A birthday is a calendar date, not an instant.
 */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function DateField({
  label,
  value,
  onChange,
  hint,
  error,
  editable = true,
  minimumDate,
  maximumDate,
}: DateFieldProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const parsed = value ? new Date(`${value}T00:00:00`) : null;
  const valid = parsed !== null && !Number.isNaN(parsed.getTime());

  // Opening on today would make a parent scroll back a decade or more. Anchoring on the newest
  // permissible date puts the wheel where the answer actually is.
  const initial = valid ? parsed : (maximumDate ?? new Date());

  function handle(event: DateTimePickerEvent, picked?: Date) {
    // Android fires 'dismissed' on cancel and the picker must close either way; leaving it open on
    // dismiss is the classic way this component ends up unclosable.
    if (Platform.OS !== 'ios') setOpen(false);
    if (event.type === 'dismissed' || !picked) return;
    onChange(toIsoDate(picked));
  }

  return (
    <View style={styles.wrap}>
      <AppText style={[styles.label, { color: theme.mutedForeground }]}>{label}</AppText>

      <Pressable
        onPress={() => editable && setOpen(true)}
        disabled={!editable}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}: ${formatDisplayDate(value)}` : `${label}: not set`}
        accessibilityHint="Opens a date picker"
        style={[
          styles.control,
          { borderColor: error ? theme.destructive : theme.border, backgroundColor: theme.card },
        ]}
      >
        <AppText
          style={[styles.value, { color: value ? theme.cardForeground : theme.mutedForeground }]}
        >
          {value ? formatDisplayDate(value) : 'DD/MM/YYYY'}
        </AppText>
      </Pressable>

      {(error || hint) && (
        <AppText style={[styles.hint, { color: error ? theme.destructive : theme.mutedForeground }]}>
          {error ?? hint}
        </AppText>
      )}

      {open && (
        <DateTimePicker
          value={initial}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handle}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing[4] },
  label: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.medium,
    marginBottom: spacing[1],
  },
  control: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    minHeight: 48,
    justifyContent: 'center',
  },
  value: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight },
  hint: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
});
