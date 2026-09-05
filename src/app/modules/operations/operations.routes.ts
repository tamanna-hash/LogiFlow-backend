import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import * as controller from './operations.controller';
import { createAssignmentSchema, cancelAssignmentSchema, updateShipmentStatusSchema, updateCourierAvailabilitySchema } from './operations.schema';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });
const courierParam = z.object({ courierProfileId: z.string().cuid() });

router.post('/assignments',
  authorize('HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'),
  validateRequest({ body: createAssignmentSchema }),
  controller.assignCourier,
);

router.patch('/assignments/:id/cancel',
  authorize('OPERATIONS_MANAGER', 'ADMIN'),
  validateRequest({ params: idParam, body: cancelAssignmentSchema }),
  controller.cancelAssignment,
);

router.patch('/shipments/:id/status',
  authorize('OPERATIONS_MANAGER', 'ADMIN'),
  validateRequest({ params: idParam, body: updateShipmentStatusSchema }),
  controller.updateShipmentStatus,
);

router.get('/couriers',
  authorize('HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'),
  controller.listCouriers,
);

router.patch('/couriers/:courierProfileId/availability',
  authorize('HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'),
  validateRequest({ params: courierParam, body: updateCourierAvailabilitySchema }),
  controller.updateCourierAvailability,
);

export default router;
