import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import * as controller from './hub.controller';
import {
  createHubSchema, updateHubSchema, hubTransferSchema,
  assignHubManagerSchema, removeHubManagerSchema,
} from './hub.schema';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });
const hubIdParam = z.object({ hubId: z.string().cuid() });
const transferParam = z.object({ hubId: z.string().cuid(), transferId: z.string().cuid() });

router.get('/destinations', authorize('HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'), controller.destinations);
router.get('/:hubId/transfers', authorize('HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'), validateRequest({ params: hubIdParam }), controller.listTransfers);

// ── Hub Manager Assignment (ADMIN only) ──────────────────────────────────────
router.get('/unassigned-managers', authorize('ADMIN'), controller.listUnassignedManagers);
router.get('/:id/manager', authorize('ADMIN'), validateRequest({ params: idParam }), controller.getHubManager);
router.put('/:id/manager', authorize('ADMIN'), validateRequest({ params: idParam, body: assignHubManagerSchema }), controller.assignHubManager);
router.delete('/:id/manager', authorize('ADMIN'), validateRequest({ params: idParam, body: removeHubManagerSchema }), controller.removeHubManager);

// ── Hub Couriers (ADMIN: assign/list; HUB_MANAGER: list own) ─────────────────
router.get('/:id/couriers', authorize('HUB_MANAGER', 'ADMIN'), validateRequest({ params: idParam }), controller.listHubCouriers);

// ── Hubs CRUD ────────────────────────────────────────────────────────────────
router.post('/', authorize('ADMIN'), validateRequest({ body: createHubSchema }), controller.createHub);
router.get('/', authorize('HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'), controller.listHubs);
router.get('/:id', authorize('HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'), validateRequest({ params: idParam }), controller.getHub);
router.patch('/:id', authorize('ADMIN'), validateRequest({ params: idParam, body: updateHubSchema }), controller.updateHub);
router.delete('/:id', authorize('ADMIN'), validateRequest({ params: idParam }), controller.deactivateHub);

// ── Hub Transfers ─────────────────────────────────────────────────────────────
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
