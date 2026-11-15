import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import { rateLimiter } from '../../lib/rateLimiter';
import { shipmentIdParamSchema } from '../shipment-risk/risk.schema';
import { investigateRequestSchema } from './investigation.schema';
import * as controller from './investigation.controller';

const router = Router();

router.use(authenticate);

/**
 * POST /api/v1/ai/shipments/:shipmentId/investigate
 *
 * Authorization:
 *  - OPERATIONS_MANAGER: sees all shipments.
 *  - HUB_MANAGER: sees only shipments currently at their hub.
 *  - ADMIN: sees all shipments.
 *  - CUSTOMER and COURIER: explicitly excluded — internal risk analysis
 *    is not customer-facing data.
 *
 * Rate limit: 10 investigations per hour per user.
 */
router.post(
  '/shipments/:shipmentId/investigate',
  authorize('OPERATIONS_MANAGER', 'HUB_MANAGER', 'ADMIN'),
  validateRequest({
    params: shipmentIdParamSchema,
    body:   investigateRequestSchema,
  }),
  rateLimiter('aiInvestigation'),
  controller.investigate,
);

export default router;
