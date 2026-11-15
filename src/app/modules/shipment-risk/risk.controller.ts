import type { Request, Response } from 'express';
import { sendSuccess, sendCreated } from '../../utils/response';
import * as riskService from './risk.service';
import { riskHistoryQuerySchema, riskListQuerySchema, type ShipmentIdParam, type RiskListRole } from './risk.schema';

/**
 * POST /risk/shipments/:shipmentId/assess
 * Trigger a fresh risk assessment for a shipment and persist it.
 */
export async function assessShipment(req: Request, res: Response): Promise<void> {
  const { shipmentId } = req.params as unknown as ShipmentIdParam;
  const assessment = await riskService.assessAndPersistRisk(shipmentId, req.user!.id);
  sendCreated(res, assessment, 'Risk assessment completed.');
}

/**
 * GET /risk/shipments/:shipmentId/latest
 * Return the most recent persisted assessment, or null if none exists.
 */
export async function getLatestAssessment(req: Request, res: Response): Promise<void> {
  const { shipmentId } = req.params as unknown as ShipmentIdParam;
  const assessment = await riskService.getLatestAssessment(shipmentId);
  sendSuccess(res, assessment, assessment ? 'Assessment retrieved.' : 'No assessment found yet.');
}

/**
 * GET /risk/shipments/:shipmentId/history
 * Paginated list of all assessments for a shipment (newest first).
 */
export async function listAssessmentHistory(req: Request, res: Response): Promise<void> {
  const { shipmentId } = req.params as unknown as ShipmentIdParam;
  const query = riskHistoryQuerySchema.parse(req.query);
  const result = await riskService.listAssessmentHistory(shipmentId, query);
  sendSuccess(res, result.assessments, 'Assessment history retrieved.', 200, result.meta);
}

/**
 * GET /risk/overview
 * Aggregate risk counts for the caller's authorized scope.
 * Cached 2 minutes server-side.
 */
export async function getRiskOverview(req: Request, res: Response): Promise<void> {
  const role = req.user!.role as RiskListRole;
  const hubId = req.user!.hubId ?? null;
  const overview = await riskService.getRiskOverview(role, hubId);
  sendSuccess(res, overview, 'Risk overview retrieved.');
}

/**
 * GET /risk/shipments
 * Paginated list of the latest risk assessment per shipment.
 * Supports filtering by riskLevel, shipmentStatus, search, and date range.
 */
export async function listRiskAssessments(req: Request, res: Response): Promise<void> {
  const role = req.user!.role as RiskListRole;
  const hubId = req.user!.hubId ?? null;
  const query = riskListQuerySchema.parse(req.query);
  const result = await riskService.listRiskAssessments(role, hubId, query);
  sendSuccess(res, result.assessments, 'Risk assessments retrieved.', 200, result.meta);
}
