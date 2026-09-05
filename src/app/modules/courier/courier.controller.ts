import type { Request, Response } from 'express';
import * as courierService from './courier.service';
import { sendSuccess } from '../../utils/response';
import { paginationSchema } from '../../utils/pagination';
import type { AssignmentStatus, AssignmentType, DeliveryFailureReason } from '@prisma/client';

export async function getAssignments(req: Request, res: Response): Promise<void> {
  const { page, limit } = paginationSchema.parse(req.query);
  const { assignments, meta } = await courierService.getAssignments(req.user!.id, {
    page, limit,
    status: req.query.status as AssignmentStatus | undefined,
    type: req.query.type as AssignmentType | undefined,
  });
  sendSuccess(res, assignments, 'Assignments fetched', 200, meta);
}

export async function acceptAssignment(req: Request, res: Response): Promise<void> {
  await courierService.acceptAssignment(req.params.id, req.user!.id);
  sendSuccess(res, null, 'Assignment accepted');
}

export async function rejectAssignment(req: Request, res: Response): Promise<void> {
  await courierService.rejectAssignment(req.params.id, req.user!.id, req.body.reason);
  sendSuccess(res, null, 'Assignment rejected');
}

export async function updateAvailability(req: Request, res: Response): Promise<void> {
  await courierService.updateAvailability(req.user!.id, req.body.availability);
  sendSuccess(res, null, 'Availability updated');
}

export async function confirmPickup(req: Request, res: Response): Promise<void> {
  await courierService.confirmPickup(req.params.shipmentId, req.user!.id);
  sendSuccess(res, null, 'Pickup confirmed');
}

export async function recordDelivery(req: Request, res: Response): Promise<void> {
  await courierService.recordDelivery(
    req.params.shipmentId, req.user!.id,
    req.body.notes, req.file?.buffer,
  );
  sendSuccess(res, null, 'Delivery recorded');
}

export async function recordDeliveryFailed(req: Request, res: Response): Promise<void> {
  await courierService.recordDeliveryFailed(
    req.params.shipmentId, req.user!.id,
    req.body.failureReason as DeliveryFailureReason,
    req.body.notes,
  );
  sendSuccess(res, null, 'Delivery failure recorded');
}

export async function getEarnings(req: Request, res: Response): Promise<void> {
  const { page, limit } = paginationSchema.parse(req.query);
  const { deliveries, totalDeliveries, meta } = await courierService.getEarnings(req.user!.id, {
    page, limit,
    fromDate: req.query.fromDate as string | undefined,
    toDate: req.query.toDate as string | undefined,
  });
  sendSuccess(res, { deliveries, totalDeliveries }, 'Earnings fetched', 200, meta);
}
