/**
 * Scanning the parent's QR.
 *
 * Lives at the root rather than inside `(child)` because it runs *before* sign-in — there is no session
 * yet, so the child shell's role guard would bounce it straight back to the chooser.
 *
 * ## Permission is asked for at the moment it is used
 *
 * Not on launch. An app for children that opens by demanding the camera, before showing what it is for,
 * is both a worse experience and a Families-review flag. The child taps "scan", reads one line
 * explaining why, and then Android asks.
 *
 * ## A denied permission is a dead end, so it is never the only route
 *
 * Camera access can be refused permanently, and a child cannot grant it themselves on a supervised
 * device. Every state of this screen therefore keeps "type it instead" visible. The QR is an
 * accelerator, never a gate.
 */
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { parseJoinLink, setStoredFamilyCode } from '@/lib/familyCodeStore';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

export default function Scan() {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);

  /**
   * The camera fires `onBarcodeScanned` continuously while a code is in frame — many times a second.
   * Without this guard the handler would run dozens of times, each one writing to the keystore and
   * pushing a navigation. A ref rather than state because it must take effect within the same tick.
   */
  const handled = useRef(false);

  const onScanned = useCallback(async ({ data }: { data: string }) => {
    if (handled.current) return;

    const code = parseJoinLink(data);
    if (code === null) {
      // Not ours. Do NOT latch `handled` — the child is probably still moving the phone towards the
      // right code, and locking the scanner on the first wrong thing in frame would strand them.
      setError('That isn’t a TaskBuddy code. Point the camera at the code your parent is showing.');
      return;
    }

    handled.current = true;
    const stored = await setStoredFamilyCode(code);
    if (!stored) {
      // The keystore refused. Better to say so than to continue to a login screen that has silently
      // hidden its family-code field with nothing behind it.
      handled.current = false;
      setError('Couldn’t save the code on this phone. You can type it in instead.');
      return;
    }

    router.replace('/child-login');
  }, []);

  // First visit: explain before asking.
  if (!permission) {
    return (
      <Screen>
        <Card>
          <AppText style={[styles.body, { color: theme.mutedForeground }]}>Getting ready…</AppText>
        </Card>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen scroll>
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          Scan your parent&apos;s code
        </AppText>
        <Card>
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            TaskBuddy needs to use the camera to read the code your parent is showing you. That&apos;s
            the only thing it uses the camera for.
          </AppText>
          <View style={styles.action}>
            <Button label="Use the camera" onPress={() => void requestPermission()} />
          </View>
          {/* `canAskAgain: false` means Android will not show the dialog any more — the child cannot
              fix this themselves, so the manual route has to carry them. */}
          {!permission.canAskAgain && (
            <AppText style={[styles.body, { color: theme.mutedForeground }]}>
              The camera is switched off for TaskBuddy on this phone. You can type the code instead.
            </AppText>
          )}
        </Card>

        <View style={styles.action}>
          <Button
            label="Type the code instead"
            variant="secondary"
            onPress={() => router.replace('/child-login')}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
        Point at the code
      </AppText>

      <View style={[styles.cameraFrame, { borderColor: theme.border }]}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          // Only QR. Leaving the default set on means a barcode on a cereal box also fires the handler.
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => void onScanned({ data })}
        />
      </View>

      {error !== null && (
        <Card style={{ borderColor: theme.destructive, borderWidth: 1 }}>
          <AppText accessibilityRole="alert" style={[styles.body, { color: theme.destructive }]}>
            {error}
          </AppText>
        </Card>
      )}

      <View style={styles.action}>
        <Button
          label="Type the code instead"
          variant="secondary"
          onPress={() => router.replace('/child-login')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[3],
  },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[2] },
  cameraFrame: {
    // Square: a QR is square, and a full-bleed viewfinder invites the child to fill the frame with it,
    // which is exactly when the quiet zone gets cropped and scanning stops working.
    aspectRatio: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  action: { marginTop: spacing[4] },
});
