/**
 * utils/zodMessages.ts - installs zod 3's wording for default validation messages (zod 4, 2026-10-27).
 * The map itself is shared with the web app: see shared/src/utils/zodV3Messages.ts.
 * Imported for its side effect by middleware/errorHandler.ts, which every request path loads.
 */

import { z } from 'zod';
import { v3Message, type ZodIssueLike } from '@taskbuddy/shared';

z.config({ customError: (iss) => v3Message(iss as unknown as ZodIssueLike) });
