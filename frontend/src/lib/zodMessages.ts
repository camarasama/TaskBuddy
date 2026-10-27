/**
 * lib/zodMessages.ts - installs zod 3's wording for default validation messages in the browser
 * (zod 4 migration, 2026-10-27). Same map as the backend: shared/src/utils/zodV3Messages.ts.
 * Imported for its side effect by app/providers.tsx, which wraps every page.
 */

import { z } from 'zod';
import { v3Message, type ZodIssueLike } from '@taskbuddy/shared';

z.config({ customError: (iss) => v3Message(iss as unknown as ZodIssueLike) });
