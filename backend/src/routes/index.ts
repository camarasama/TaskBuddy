import { Router } from 'express';
import { authRouter } from './auth';
import { familyRouter } from './family';
import { taskRouter } from './tasks';
import { rewardRouter } from './rewards';
import { dashboardRouter } from './dashboard';
import { achievementRouter } from './achievements';

export const apiRouter = Router();

// Mount route modules
apiRouter.use('/auth', authRouter);
apiRouter.use('/families', familyRouter);
apiRouter.use('/tasks', taskRouter);
apiRouter.use('/rewards', rewardRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/achievements', achievementRouter);

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
    },
  });
});
