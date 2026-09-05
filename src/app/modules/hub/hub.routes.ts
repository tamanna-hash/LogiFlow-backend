import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import * as controller from './hub.controller';
import { createHubSchema, updateHubSchema, hubTransferSchema } from './hub.schema';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });
const hubIdParam = z.object({ hubId: z.string().cuid() });
const transferParam = z.object({ hubId: z.string().cuid(), transferId: z.string().cuid() });

// Hubs
router.post('/', authorize('ADMIN'), validateRequest({ body: createHubSchema }), controller.createHub);
router.get('/', authorize('HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'), controller.listHubs);
router.get('/:id', authorize('HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'), validateRequest({ params: idParam }), controller.getHub);
router.patch('/:id', authorize('ADMIN'), validateRequest({ params: idParam, body: updateHubSchema }), controller.updateHub);
router.delete('/:id', authorize('ADMIN'), validateRequest({ params: idParam }), controller.deactivateHub);

// Hub Transfers
router.post('/:hubId/transfers',
  authorize('HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'),
  validateRequest({ params: hubIdParam, body: hubTransferSchema }),
  controller.createTransfer,
);
router.patch('/:hubId/transfers/:transferId/arrive',
  authorize('HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'),
  validateRequest({ params: transferParam }),
  controller.confirmArrival,
);

export default router;
