/**
 * routes/meta.ts — client metadata endpoints (P0-2).
 *
 * Public and unauthenticated by design: the app calls this at launch, *before* it has a session,
 * because the point is to stop an obsolete build from talking to the API at all. It exposes only
 * version floors we publish anyway in the store listing, so there is nothing here to leak.
 */

import { Router } from 'express';
import { config } from '../config';
import { compareVersions, getClient, isMobilePlatform, MOBILE_PLATFORMS } from '../utils/client';

export const metaRouter = Router();

/**
 * GET /meta/min-version
 *
 * Returns the minimum supported build per platform. When the caller identifies itself with a
 * well-formed `X-Client` header, the comparison is done server-side too and returned as
 * `upgradeRequired`, so the app doesn't have to reimplement semver ordering to decide whether to
 * show its blocking upgrade screen.
 */
metaRouter.get('/min-version', (req, res) => {
  const platforms = Object.fromEntries(
    MOBILE_PLATFORMS.map((platform) => [platform, config.mobile.minVersion[platform] ?? '0.0.0'])
  );

  const client = getClient(req);
  const upgradeRequired =
    client !== null &&
    isMobilePlatform(client.platform) &&
    compareVersions(client.version, platforms[client.platform]) < 0;

  res.json({
    success: true,
    data: {
      platforms,
      client: client ?? null,
      upgradeRequired,
    },
  });
});
