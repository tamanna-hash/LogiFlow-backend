import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import { shipmentIdParamSchema } from './risk.schema';
import * as controller from './risk.controller';

const router = Router();

// All risk endpoints require authentication.
router.use(authenticate);

const idParam = { params: shipmentIdParamSchema };

/**
 * POST /api/v1/risk/shipments/:shipmentId/assess
 * Trigger a fresh risk assessment. Staff roles only — customers do not
 * receive risk scores directly (operational data, not customer-facing).
 */
router.post(
  '/shipments/:shipmentId/assess',
  authorize('OPERATIONS_MANAGER', 'HUB_MANAGER', 'ADMIN'),
  validateRequest(idParam),
  controller.assessShipment,
);

/**
 * GET /api/v1/risk/shipments/:shipmentId/latest
 * Retrieve the latest persisted assessment. All staff roles may view.
 */
router.get(
  '/shipments/:shipmentId/latest',
  authorize('COURIER', 'HUB_MANAGER', 'OPERATIONS_MANAGER', 'ADMIN'),
  validateRequest(idParam),
  controller.getLatestAssessment,
);

/**
 * GET /api/v1/risk/shipments/:shipmentId/history
 * Full paginated assessment history. Management roles only.
 */
router.get(
  '/shipments/:shipmentId/history',
  authorize('OPERATIONS_MANAGER', 'ADMIN'),
  validateRequest(idParam),
  controller.listAssessmentHistory,
);

export default router;
