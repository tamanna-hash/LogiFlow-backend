import type { DeliveryType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { cacheGet, cacheSet, CacheKeys } from '../../lib/redis';
import { NotFoundError, BadRequestError } from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import { notDeleted } from '../../utils/notDeleted';
import type { CreatePricingRuleInput, CalculatePriceInput } from './pricing.schema';

const ruleSelect = {
  id: true, name: true, originZoneId: true, destinationZoneId: true,
  deliveryType: true, parcelType: true, basePrice: true, pricePerKg: true,
  baseWeightKg: true, zoneSurcharge: true, deliveryTypeSurcharge: true,
  isDefault: true, isActive: true, createdAt: true,
};

export async function createPricingRule(input: CreatePricingRuleInput, actorId: string) {
  const rule = await prisma.pricingRule.create({ data: { ...input, basePrice: input.basePrice, pricePerKg: input.pricePerKg }, select: ruleSelect });
  await createAuditLog({ actorId, action: 'PRICING_RULE_CREATED', resourceType: 'PricingRule', resourceId: rule.id });
  return rule;
}

export async function listPricingRules(params: {
  page: number; limit: number; isActive?: boolean;
  deliveryType?: DeliveryType; originZoneId?: string; destinationZoneId?: string;
}) {
  const { page, limit, isActive, deliveryType, originZoneId, destinationZoneId } = params;
  const where = {
    ...notDeleted(),
    ...(isActive !== undefined && { isActive }),
    ...(deliveryType && { deliveryType }),
    ...(originZoneId && { originZoneId }),
    ...(destinationZoneId && { destinationZoneId }),
  };

  const [rules, total] = await Promise.all([
    prisma.pricingRule.findMany({ where, orderBy: { createdAt: 'desc' }, ...getPrismaSkipTake(page, limit), select: ruleSelect }),
    prisma.pricingRule.count({ where }),
  ]);

  return { rules, meta: buildPaginationMeta(total, page, limit) };
}

export async function updatePricingRule(id: string, input: Partial<CreatePricingRuleInput>, actorId: string) {
  const rule = await prisma.pricingRule.findUnique({ where: { id, ...notDeleted() }, select: { id: true } });
  if (!rule) throw new NotFoundError('Pricing rule not found.');
  const updated = await prisma.pricingRule.update({ where: { id }, data: input, select: ruleSelect });
  await createAuditLog({ actorId, action: 'PRICING_RULE_UPDATED', resourceType: 'PricingRule', resourceId: id });
  return updated;
}

export async function deactivatePricingRule(id: string, actorId: string) {
  const rule = await prisma.pricingRule.findUnique({ where: { id, ...notDeleted() }, select: { id: true } });
  if (!rule) throw new NotFoundError('Pricing rule not found.');
  await prisma.pricingRule.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await createAuditLog({ actorId, action: 'PRICING_RULE_DEACTIVATED', resourceType: 'PricingRule', resourceId: id });
}

export interface PriceBreakdown {
  basePrice: number;
  weightCharge: number;
  zoneSurcharge: number;
  deliveryTypeSurcharge: number;
  total: number;
}

/**
 * calculatePrice — server-side price computation.
 * Matching priority: most specific rule first, default rule as fallback.
 * Result is cached in Redis for 5 minutes.
 */
export async function calculatePrice(input: CalculatePriceInput): Promise<PriceBreakdown> {
  const cacheKey = CacheKeys.pricingCalc(
    `${input.originZoneId}:${input.destinationZoneId}:${input.deliveryType}:${input.parcelType}:${input.weightKg}`,
  );

  const cached = await cacheGet<PriceBreakdown>(cacheKey);
  if (cached) return cached;

  // Find best matching rule — most specific first
  const rule = await prisma.pricingRule.findFirst({
    where: {
      isActive: true,
      deletedAt: null,
      OR: [
        // Exact match
        { originZoneId: input.originZoneId, destinationZoneId: input.destinationZoneId, deliveryType: input.deliveryType, parcelType: input.parcelType },
        // Zone match without type specificity
        { originZoneId: input.originZoneId, destinationZoneId: input.destinationZoneId, deliveryType: null, parcelType: null },
        // Default rule
        { isDefault: true, originZoneId: null, destinationZoneId: null },
      ],
    },
    orderBy: [
      { originZoneId: 'asc' },   // non-null (specific) sorts before null (default)
      { deliveryType: 'asc' },
    ],
    select: ruleSelect,
  });

  if (!rule) throw new BadRequestError('No pricing rule found for this route. Please contact support.');

  const basePrice = Number(rule.basePrice);
  const pricePerKg = Number(rule.pricePerKg);
  const baseWeightKg = rule.baseWeightKg;
  const zoneSurcharge = Number(rule.zoneSurcharge);
  const deliveryTypeSurcharge = Number(rule.deliveryTypeSurcharge);

  const weightCharge = Math.max(0, input.weightKg - baseWeightKg) * pricePerKg;
  const total = Math.round((basePrice + weightCharge + zoneSurcharge + deliveryTypeSurcharge) * 100) / 100;

  const breakdown: PriceBreakdown = { basePrice, weightCharge: Math.round(weightCharge * 100) / 100, zoneSurcharge, deliveryTypeSurcharge, total };

  await cacheSet(cacheKey, breakdown, 300); // 5 min TTL
  return breakdown;
}
