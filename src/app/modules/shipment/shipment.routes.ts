import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import * as controller from './shipment.controller';
import {
  createShipmentSchema, updateShipmentSchema, cancelShipmentSchema,
  pickupRequestSchema, returnShipmentSchema,
} from './shipment.schema';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });

router.post('/', authorize('CUSTOMER', 'ADMIN'), validateRequest({ body: createShipmentSchema }), controller.createShipment);
router.get('/', controller.listShipments);
router.get('/:id', validateRequest({ params: idParam }), controller.getShipment);
router.patch('/:id', authorize('CUSTOMER', 'ADMIN'), validateRequest({ params: idParam, body: updateShipmentSchema }), controller.updateShipment);
router.post('/:id/cancel', authorize('CUSTOMER', 'OPERATIONS_MANAGER', 'ADMIN'), validateRequest({ params: idParam, body: cancelShipmentSchema }), controller.cancelShipment);
router.post('/:id/pickup-request', authorize('CUSTOMER', 'ADMIN'), validateRequest({ params: idParam, body: pickupRequestSchema }), controller.requestPickup);
router.get('/:id/tracking', validateRequest({ params: idParam }), controller.getTracking);
router.post('/:id/return', authorize('OPERATIONS_MANAGER', 'ADMIN'), validateRequest({ params: idParam, body: returnShipmentSchema }), controller.initiateReturn);

export default router;
