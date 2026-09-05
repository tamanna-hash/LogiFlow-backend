import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import { uploadSingle } from '../../lib/multer';
import * as controller from './courier.controller';
import { updateAvailabilitySchema, rejectAssignmentSchema, deliveryFailedSchema, deliveryConfirmSchema } from './courier.schema';
import { z } from 'zod';

const router = Router();
router.use(authenticate, authorize('COURIER'));

const assignmentIdParam = z.object({ id: z.string().cuid() });
const shipmentIdParam = z.object({ shipmentId: z.string().cuid() });

router.get('/assignments', controller.getAssignments);
router.patch('/assignments/:id/accept', validateRequest({ params: assignmentIdParam }), controller.acceptAssignment);
router.patch('/assignments/:id/reject', validateRequest({ params: assignmentIdParam, body: rejectAssignmentSchema }), controller.rejectAssignment);
router.patch('/availability', validateRequest({ body: updateAvailabilitySchema }), controller.updateAvailability);
router.post('/shipments/:shipmentId/pickup-confirm', validateRequest({ params: shipmentIdParam }), controller.confirmPickup);
router.post('/shipments/:shipmentId/deliver',
  uploadSingle('proofImage'),
  validateRequest({ params: shipmentIdParam, body: deliveryConfirmSchema }),
  controller.recordDelivery,
);
router.post('/shipments/:shipmentId/delivery-failed',
  validateRequest({ params: shipmentIdParam, body: deliveryFailedSchema }),
  controller.recordDeliveryFailed,
);
router.get('/earnings', controller.getEarnings);

export default router;
