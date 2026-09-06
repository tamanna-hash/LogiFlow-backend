import type { Request, Response } from 'express';
import * as opsService from './operations.service';
import { sendSuccess, sendCreated } from '../../utils/response';
import { paginationSchema } from '../../utils/pagination';
import type { CourierAvailability, Role } from '@prisma/client';

export async function assignCourier(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const assignment = await opsService.assignCourier(req.body, user.id, user.role as Role, user.hubId);
  sendCreated(res, assignment, 'Courier assigned');
}

export async function cancelAssignment(req: Request, res: Response): Promise<void> {
  await opsService.cancelAssignment(String(req.params.id), req.body.reason, req.user!.id);
  sendSuccess(res, null, 'Assignment cancelled');
}

export async function updateShipmentStatus(req: Request, res: Response): Promise<void> {
  await opsService.updateShipmentStatus(String(req.params.id), req.body.status, req.body.reason, req.user!.id);
  sendSuccess(res, null, 'Shipment status updated');
}

export async function listCouriers(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { page, limit } = paginationSchema.parse(req.query);
  const { couriers, meta } = await opsService.listCouriers({
    page, limit,
    availability: req.query.availability as string | undefined,
    hubId: req.query.hubId as string | undefined,
    search: req.query.search as string | undefined,
    actorRole: user.role as Role,
    actorHubId: user.hubId,
  });
  sendSuccess(res, couriers, 'Couriers fetched', 200, meta);
}

export async function updateCourierAvailability(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  await opsService.updateCourierAvailability(
    String(req.params.courierProfileId),
    req.body.availability as CourierAvailability,
    user.role as Role,
    user.hubId,
  );
  sendSuccess(res, null, 'Courier availability updated');
}
