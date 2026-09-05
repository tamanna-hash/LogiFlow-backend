import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import * as controller from '../hub/hub.controller';
import { createZoneSchema, updateZoneSchema } from '../hub/hub.schema';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });

router.post('/', authorize('ADMIN'), validateRequest({ body: createZoneSchema }), controller.createZone);
router.get('/', authorize('HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'), controller.listZones);
router.patch('/:id', authorize('ADMIN'), validateRequest({ params: idParam, body: updateZoneSchema }), controller.updateZone);
router.delete('/:id', authorize('ADMIN'), validateRequest({ params: idParam }), controller.deleteZone);

export default router;
