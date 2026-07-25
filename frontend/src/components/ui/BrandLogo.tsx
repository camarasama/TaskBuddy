'use client';

/**
 * components/ui/BrandLogo - the single place the TaskBuddy logo is rendered.
 *
 * Background: PR #23 shipped the real logo into frontend/public, but the app itself never adopted
 * it - every in-app "logo" stayed a CSS gradient square with a lucide CheckCircle2 in it. This
 * replaces all of those, and centralising it means a future rebrand is one file.
 *
 * Two variants, because the source art forces the distinction:
 *
 *   'lockup' - mark + "TaskBuddy" wordmark. Use where there is horizontal room; it REPLACES any
 *              adjacent text label, since the wordmark is part of the image.
 *   'mark'   - mark only. Use below ~100px wide, where the wordmark would be an illegible smudge,
 *              and anywhere a text label already sits alongside.
 *
 * Both are derived from public/icon-master.png (the owner's favicon.io export). No mark-only or
 * vector source was supplied, so logo-mark.png / logo-full.png were produced by cropping away the
 * baked-in wordmark and the rounded frame, then keying out the light neutral background - which is
 * what makes 'mark' safe on the dark admin sidebar. Regenerate them from icon-master.png if the
 * logo is ever replaced.
 */

import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type Variant = 'lockup' | 'mark';

interface BrandLogoProps {
  variant?: Variant;
  /** Rendered width in px. Height follows the art's aspect ratio. */
  size?: number;
  /** Wrap in a link (usually the role's dashboard). Omit for decorative use. */
  href?: string;
  className?: string;
  /**
   * Accessible name. Defaults to "TaskBuddy". Pass "" when an adjacent visible text label already
   * names the brand, so screen readers don't hear it twice.
   */
  alt?: string;
  priority?: boolean;
}

// Intrinsic sizes of the generated assets, needed by next/image to reserve space.
const ART = {
  lockup: { src: '/logo-full.png', width: 512, height: 508 },
  mark: { src: '/logo-mark.png', width: 256, height: 233 },
} as const;

export function BrandLogo({
  variant = 'lockup',
  size = 140,
  href,
  className,
  alt = 'TaskBuddy',
  priority = false,
}: BrandLogoProps) {
  const art = ART[variant];
  const height = Math.round((size / art.width) * art.height);

  const image = (
    <Image
      src={art.src}
      alt={alt}
      width={size}
      height={height}
      priority={priority}
      className={cn('select-none', className)}
      // Local asset with a fixed intrinsic size; skipping the optimiser keeps the transparent PNG
      // byte-identical and avoids a per-size cache entry for what is a tiny file.
      unoptimized
    />
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex items-center shrink-0" aria-label={alt || 'TaskBuddy'}>
        {image}
      </Link>
    );
  }

  return image;
}
