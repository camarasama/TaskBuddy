/**
 * A QR code drawn from plain Views.
 *
 * ## Why not `react-native-qrcode-svg`
 *
 * That is the usual choice and it pulls in `react-native-svg` — a **native module**. Adding one is the
 * failure class that cost Phase 0 four rounds, and this phase already adds `expo-camera`; two at once
 * doubles the surface of a rebuild that cannot be tested without the owner. `qrcode-generator` is pure
 * JavaScript with zero dependencies, so the encoding costs no native code at all and the only new
 * native module in this phase is the camera.
 *
 * ## Why the view count is not a problem
 *
 * A family code encodes to a **21×21** matrix — 441 modules, which as one View each would be wasteful
 * on a cheap phone. So each row is emitted as *runs* of consecutive same-colour modules merged into a
 * single View with a flex weight. A typical row collapses to five or six spans, putting the whole code
 * at well under a hundred views: cheap enough for a static screen, and no measuring or absolute
 * positioning to get wrong across densities.
 *
 * `level: 'M'` (~15% recovery) is the default because this is read off a bright phone screen held a few
 * inches away, not a printed sticker — higher correction would only make the matrix denser for no gain.
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import qrcode from 'qrcode-generator';

/** One horizontal span of identical modules. */
interface Run {
  dark: boolean;
  length: number;
}

/** Collapse a row of booleans into runs, so a 21-module row becomes a handful of Views. */
function toRuns(row: boolean[]): Run[] {
  const runs: Run[] = [];
  for (const dark of row) {
    const last = runs[runs.length - 1];
    if (last && last.dark === dark) last.length += 1;
    else runs.push({ dark, length: 1 });
  }
  return runs;
}

export function QRCode({
  value,
  size = 220,
  dark = '#000000',
  light = '#FFFFFF',
}: {
  value: string;
  size?: number;
  dark?: string;
  light?: string;
}) {
  const rows = useMemo(() => {
    // `0` lets the encoder pick the smallest type version that fits, rather than pinning one that
    // would silently fail to hold a longer code.
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();

    const count = qr.getModuleCount();
    return Array.from({ length: count }, (_, row) =>
      toRuns(Array.from({ length: count }, (_, col) => qr.isDark(row, col)))
    );
  }, [value]);

  return (
    <View
      style={[styles.frame, { width: size, height: size, backgroundColor: light }]}
      accessibilityRole="image"
      // The code itself is never read aloud — it is a credential, and a screen reader announcing it in a
      // room is the opposite of what the QR flow is for. The manual-entry path is the accessible route.
      accessibilityLabel="Sign-in QR code"
    >
      {rows.map((runs, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {runs.map((run, runIndex) => (
            <View
              key={runIndex}
              style={{ flex: run.length, backgroundColor: run.dark ? dark : light }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // A quiet zone is required for reliable scanning; without padding the outermost modules bleed into
  // whatever is behind the code and readers lose the finder patterns.
  frame: { padding: 12 },
  row: { flex: 1, flexDirection: 'row' },
});
