import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import { rateLimiter } from '../../lib/rateLimiter';
import * as controller from './payment.controller';
import { initiatePaymentSchema } from './payment.schema';
import { z } from 'zod';

const router = Router();

const shipmentIdParam = z.object({ shipmentId: z.string().cuid() });

// bKash callback — public, no JWT (bKash redirects browser here)
router.get('/bkash/callback', controller.bkashCallback);

// Authenticated routes
router.post('/bkash/initiate',
  authenticate,
  rateLimiter('paymentInitiate'),
  authorize('CUSTOMER', 'ADMIN'),
  validateRequest({ body: initiatePaymentSchema }),
  controller.initiatePayment,
);

router.get('/shipment/:shipmentId',
  authenticate,
  authorize('CUSTOMER', 'ADMIN'),
  validateRequest({ params: shipmentIdParam }),
  controller.getPaymentByShipment,
);

router.get('/',
  authenticate,
  authorize('ADMIN'),
  controller.listPayments,
);

export default router;
