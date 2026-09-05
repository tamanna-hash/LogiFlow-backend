import { Router } from 'express';
import { authenticate } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import { rateLimiter } from '../../lib/rateLimiter';
import * as controller from './auth.controller';
import {
  registerSchema, loginSchema, refreshTokenSchema,
  logoutSchema, changePasswordSchema,
} from './auth.schema';

const router = Router();

router.post('/register',
  rateLimiter('register'),
  validateRequest({ body: registerSchema }),
  controller.register,
);

router.post('/login',
  rateLimiter('login'),
  validateRequest({ body: loginSchema }),
  controller.login,
);

router.post('/refresh',
  validateRequest({ body: refreshTokenSchema }),
  controller.refreshToken,
);

router.post('/logout',
  authenticate,
  validateRequest({ body: logoutSchema }),
  controller.logout,
);

router.get('/google', controller.googleAuth);
router.get('/google/callback', controller.googleCallback);

router.patch('/change-password',
  authenticate,
  rateLimiter('changePassword'),
  validateRequest({ body: changePasswordSchema }),
  controller.changePassword,
);

export default router;
