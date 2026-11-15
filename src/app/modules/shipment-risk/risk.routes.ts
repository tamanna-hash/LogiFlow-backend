import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import { shipmentIdParamSchema, riskListQuerySchema } from './risk.schema';
import * as controller from './risk.controller';

const router = Router();

// All risk endpoints require authentication.
router.use(authenticate);

const idParam = { params: shipmentIdParamSchema };
const listQuery = { query: riskListQuerySchema };

// ── New Day-2 endpoints ───────────────────────────────────────────────────────

/**
 * GET /api/v1/risk/overview
 * Aggregate risk counts scoped to the caller's role.
 * HUB_MANAGER sees only their hub's shipments.
 */
router.get(
  '/overview',
  authorize('OPERATIONS_MANAGER', 'HUB_MANAGER', 'ADMIN'),
  controller.getRiskOverview,
);

/**
 * GET /api/v1/risk/shipments
 * Paginated latest-assessment-per-shipment list.
 * Supports riskLevel, shipmentStatus, search, fromDate, toDate filters.
 */
router.get(
  '/shipments',
  authorize('OPERATIONS_MANAGER', 'HUB_MANAGER', 'ADMIN'),
  validateRequest(listQuery),
  controller.listRiskAssessments,
);

// ── Existing Day-1 endpoints (unchanged) ─────────────────────────────────────

/**
 * POST /api/v1/risk/shipments/:shipmentId/assess
 * Trigger a fresh risk assessment. Staff roles only.
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
