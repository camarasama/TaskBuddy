/**
 * routes/onboarding.ts — guided setup wizard state (growth roadmap §3.2).
 * Mounted at /api/v1/onboarding. Parent-only.
 *
 *   GET   /onboarding              - current checklist state
 *   POST  /onboarding/steps/:step  - mark a step done (emits SETUP_STEP once)
 *   POST  /onboarding/dismiss      - skip the checklist; it is optional by design
 *   POST  /onboarding/first-approval - seed the engineered first approval for a child
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireParent, familyIsolation } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { ValidationError } from '../middleware/errorHandler';
import {
  ONBOARDING_STEPS,
  OnboardingService,
  type OnboardingStep,
} from '../services/OnboardingService';

export const onboardingRouter = Router();

onboardingRouter.use(authenticate, familyIsolation, requireParent);

const firstApprovalSchema = z.object({ childId: z.string().uuid() });

onboardingRouter.get('/', async (req, res, next) => {
  try {
    const state = await OnboardingService.getState(req.familyId!);
    res.json({
      success: true,
      data: { state, steps: ONBOARDING_STEPS, isComplete: OnboardingService.isComplete(state) },
    });
  } catch (error) {
    next(error);
  }
});

onboardingRouter.post('/steps/:step', async (req, res, next) => {
  try {
    const step = req.params.step as OnboardingStep;
    if (!(ONBOARDING_STEPS as readonly string[]).includes(step)) {
      throw new ValidationError(`Unknown setup step "${req.params.step}"`);
    }

    const state = await OnboardingService.completeStep({ familyId: req.familyId!, step });
    res.json({
      success: true,
      data: { state, isComplete: OnboardingService.isComplete(state) },
    });
  } catch (error) {
    next(error);
  }
});

onboardingRouter.post('/dismiss', async (req, res, next) => {
  try {
    const state = await OnboardingService.dismiss(req.familyId!);
    res.json({ success: true, data: { state } });
  } catch (error) {
    next(error);
  }
});

/**
 * Seed the task the parent approves in-flow.
 *
 * Returns `created: false` when one already exists, so re-entering the final step reuses the same
 * assignment instead of stacking demo tasks.
 */
onboardingRouter.post('/first-approval', validateBody(firstApprovalSchema), async (req, res, next) => {
  try {
    const { childId } = firstApprovalSchema.parse(req.body);
    const result = await OnboardingService.seedFirstApproval({
      familyId: req.familyId!,
      createdBy: req.user!.userId,
      childId,
    });
    res.status(result.created ? 201 : 200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
