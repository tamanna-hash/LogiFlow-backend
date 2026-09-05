import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import { uploadSingle } from '../../lib/multer';
import * as controller from './user.controller';
import { updateProfileSchema, updateRoleSchema } from './user.schema';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid('Invalid user ID') });

// Own profile
router.get('/me', controller.getMe);
router.patch('/me',
  uploadSingle('avatar'),
  validateRequest({ body: updateProfileSchema }),
  controller.updateMe,
);

// Admin — user management
router.get('/', authorize('ADMIN'), controller.listUsers);
router.get('/:id', authorize('ADMIN'), validateRequest({ params: idParam }), controller.getUserById);
router.patch('/:id/role', authorize('ADMIN'), validateRequest({ params: idParam, body: updateRoleSchema }), controller.updateUserRole);
router.delete('/:id', authorize('ADMIN'), validateRequest({ params: idParam }), controller.deleteUser);

export default router;
