import { Router } from 'express';
import { authenticate } from '../../middleware/checkAuth';
import * as controller from './notification.controller';

const router = Router();

// All notification routes require authentication
router.use(authenticate);

router.get('/', controller.getNotifications);
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', controller.markRead);

export default router;
