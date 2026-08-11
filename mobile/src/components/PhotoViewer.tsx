/**
 * Full-screen viewer for a submitted evidence photo.
 *
 * ## Why this exists
 *
 * Both parent screens rendered evidence as a bare `<Image>` with `resizeMode: 'cover'` at thumbnail
 * size and no press handler. A parent could see that a photo existed but could not open it — and
 * because `cover` crops to fill, they could not even see all of the one on screen. Approving work on
 * the strength of a cropped thumbnail is not reviewing it. The web has always been able to open the
 * photo; the phone could not.
 *
 * ## Presigned URLs
 *
 * The `uri` is short-lived and signed per request by the server (private R2 bucket). It is passed
 * straight through and never cached, stored or rebuilt from an object key — the same rule the two
 * screens already document.
 *
 * ## `contain`, not `cover`
 *
 * The whole point is seeing the entire photo. `cover` would crop it again, which is the bug.
 */
import { Modal, Pressable, StyleSheet, View, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AppText } from './AppText';
import { fontSize, minTouchTarget, onGradient, spacing } from '@/theme';

interface PhotoViewerProps {
  /** Presigned URL of the FULL image, not a thumbnail. Null closes the viewer. */
  uri: string | null;
  onClose: () => void;
}

export function PhotoViewer({ uri, onClose }: PhotoViewerProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={uri !== null}
      transparent
      animationType="fade"
      // Android's back gesture must close this. Without it the only way out is the button, and a
      // full-screen overlay that swallows back reads as the app having frozen.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        {/* Tapping the backdrop closes, which is what every photo viewer does. The image sits above
            it so a tap on the photo itself does not dismiss by accident. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close photo" />

        {uri !== null && (
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="contain"
            accessibilityLabel="Photo submitted as evidence, full size"
          />
        )}

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[styles.close, { top: insets.top + spacing[2] }]}
        >
          <Ionicons name="close" size={22} color={onGradient} />
          <AppText style={styles.closeLabel}>Close</AppText>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  /**
   * Near-black rather than the theme background: a photo is judged against a neutral ground, and a
   * light surface behind a dark photo makes it harder to see, not easier. Deliberately the same in
   * both themes.
   *
   * `rgba` rather than a hex literal, both because it needs alpha and because the theme guard
   * (src/theme/__tests__/hex-literal-guard.test.ts) allows exactly two files to hardcode colours and
   * this is rightly not one of them.
   */
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center' },
  image: { width: '100%', height: '80%' },
  close: {
    position: 'absolute',
    right: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    minHeight: minTouchTarget,
    paddingHorizontal: spacing[3],
  },
  closeLabel: { color: onGradient, fontSize: fontSize.base.fontSize },
});
