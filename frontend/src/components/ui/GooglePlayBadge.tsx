/**
 * components/ui/GooglePlayBadge - the official "Get it on Google Play" badge, linked to the
 * production store listing (live since 2026-10-08).
 *
 * The image is Google's own badge PNG, served from frontend/public so the CSP needs no new img-src.
 * Google's badge guidelines forbid recolouring or redrawing it, and the PNG carries its own
 * transparent margin, so size it by height only and do not add a border or background.
 *
 * The iPhone note sits next to it on purpose: the web app is the only way in on iOS for now.
 */

import Image from 'next/image';
import { cn } from '@/lib/utils';

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.gettaskbuddy.app';

interface GooglePlayBadgeProps {
  /** Show the "iPhone app coming soon" line beside the badge. */
  showIosNote?: boolean;
  className?: string;
}

export function GooglePlayBadge({ showIosNote = true, className }: GooglePlayBadgeProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className="inline-block">
        <Image
          src="/google-play-badge.png"
          alt="Get it on Google Play"
          width={194}
          height={75}
          className="h-[60px] w-auto"
        />
      </a>
      {showIosNote && (
        <p className="text-sm text-slate-500">Android app on Google Play. iPhone app coming soon.</p>
      )}
    </div>
  );
}
