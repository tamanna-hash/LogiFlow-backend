import { prisma } from '../../lib/prisma';
import { cacheGet, cacheSet, CacheKeys } from '../../lib/redis';
import { NotFoundError } from '../../errors';

/**
 * Public tracking — returns limited shipment info without personal data.
 * Cached in Redis for 60 seconds.
 */
export async function getPublicTracking(trackingNumber: string) {
  const cacheKey = CacheKeys.tracking(trackingNumber);
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const shipment = await prisma.shipment.findUnique({
    where: { trackingNumber, deletedAt: null },
    select: {
      trackingNumber: true,
      status: true,
      paymentStatus: true,
      deliveryType: true,
      recipientCity: true,
      createdAt: true,
      updatedAt: true,
      originZone: { select: { name: true } },
      destinationZone: { select: { name: true } },
      currentHub: { select: { name: true, city: true } },
      trackingEvents: {
        orderBy: { createdAt: 'asc' },
        select: { status: true, description: true, location: true, createdAt: true },
      },
    },
  });

  if (!shipment) throw new NotFoundError('Tracking number not found.');

  await cacheSet(cacheKey, shipment, 60);
  return shipment;
}
