import type { Request, Response } from 'express';
import * as pricingService from './pricing.service';
import { sendSuccess, sendCreated } from '../../utils/response';
import { paginationSchema } from '../../utils/pagination';
import type { DeliveryType } from '@prisma/client';

export async function createRule(req: Request, res: Response): Promise<void> {
  const rule = await pricingService.createPricingRule(req.body, req.user!.id);
  sendCreated(res, rule, 'Pricing rule created');
}

export async function listRules(req: Request, res: Response): Promise<void> {
  const { page, limit } = paginationSchema.parse(req.query);
  const { rules, meta } = await pricingService.listPricingRules({
    page, limit,
    isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
    deliveryType: req.query.deliveryType as DeliveryType | undefined,
    originZoneId: req.query.originZoneId as string | undefined,
    destinationZoneId: req.query.destinationZoneId as string | undefined,
  });
  sendSuccess(res, rules, 'Pricing rules fetched', 200, meta);
}

export async function updateRule(req: Request, res: Response): Promise<void> {
  const rule = await pricingService.updatePricingRule(req.params.id, req.body, req.user!.id);
  sendSuccess(res, rule, 'Pricing rule updated');
}

export async function deleteRule(req: Request, res: Response): Promise<void> {
  await pricingService.deactivatePricingRule(req.params.id, req.user!.id);
  sendSuccess(res, null, 'Pricing rule deactivated');
}

export async function calculatePrice(req: Request, res: Response): Promise<void> {
  const breakdown = await pricingService.calculatePrice(req.body);
  sendSuccess(res, breakdown, 'Price calculated');
}
