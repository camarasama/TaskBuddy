/**
 * Evidence photos must be openable on the phone.
 *
 * Reported: a parent could see that a photo had been submitted but could not tap it. The web could
 * open it; the phone could not. Worse, both screens rendered the thumbnail with `resizeMode: 'cover'`,
 * which crops to fill — so the grid never showed the whole photo either. Approving work on the
 * strength of a crop is not reviewing it.
 *
 * A source assertion rather than a render test: what was missing was a press handler and a viewer,
 * and both are visible in the source without standing up navigation, a query client and a theme.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');

describe('parent approvals', () => {
  const source = read('app/(parent)/approvals.tsx');

  it('wraps each evidence photo in a press handler', () => {
    expect(source).toContain('onOpenPhoto(photo.fileUrl');
    expect(source).toMatch(/accessibilityRole="imagebutton"/);
  });

  it('mounts the full-screen viewer', () => {
    expect(source).toContain('<PhotoViewer');
  });
});

describe('parent task detail', () => {
  const source = read('app/(parent)/task-detail.tsx');

  it('opens the FULL image, not the thumbnail it displays', () => {
    // The grid shows `thumbnailUrl`. Enlarging that would hand a parent a bigger blurry crop and
    // nothing more, so the tap must prefer fileUrl.
    expect(source).toContain('setViewingPhoto((photo.fileUrl || photo.thumbnailUrl)');
  });

  it('mounts the viewer for BOTH the open and completed assignment lists', () => {
    // The completed list is the one a parent goes back to in order to review, so it is the more
    // important of the two and was the easier to miss.
    expect(source.match(/setViewingPhoto=\{setViewingPhoto\}/g) ?? []).toHaveLength(2);
    expect(source).toContain('<PhotoViewer');
  });
});

describe('PhotoViewer', () => {
  const source = read('src/components/PhotoViewer.tsx');

  it('shows the whole photo rather than cropping it again', () => {
    expect(source).toContain("resizeMode=\"contain\"");
    expect(source).not.toContain("resizeMode=\"cover\"");
  });

  it('can be dismissed with the Android back gesture', () => {
    // A full-screen overlay that swallows back reads as the app having frozen.
    expect(source).toContain('onRequestClose={onClose}');
  });
});
