import { Router } from 'express';
import { authRouter } from './auth';
import { familyRouter } from './family';
import { taskRouter } from './tasks';
// M5 — import the self-assign router
import { taskSelfAssignRouter } from './taskSelfAssign';
import { rewardRouter } from './rewards';
import { dashboardRouter } from './dashboard';
import { achievementRouter } from './achievements';
// M9 — Email log admin viewer + resend endpoint
import  emailRouter  from './emails';

export const apiRouter = Router();

// Mount route modules
apiRouter.use('/auth', authRouter);
apiRouter.use('/families', familyRouter);
// M5 — Mount self-assign BEFORE the main taskRouter so the more specific path matches first
apiRouter.use('/tasks/assignments/self-assign', taskSelfAssignRouter);
apiRouter.use('/tasks', taskRouter);
apiRouter.use('/rewards', rewardRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/achievements', achievementRouter);
// M9 — Admin email log viewer (GET /admin/emails, POST /admin/emails/:id/resend)
apiRouter.use('/admin/emails', emailRouter);

// API info endpoint
apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'TaskBuddy API',
    version: '1.0.0',
    description: 'Family task management with gamification',
    endpoints: {
      auth: '/api/v1/auth',
      families: '/api/v1/families',
      tasks: '/api/v1/tasks',
      rewards: '/api/v1/rewards',
      dashboard: '/api/v1/dashboard',
      achievements: '/api/v1/achievements',
      adminEmails: '/api/v1/admin/emails',
    },
  });
});