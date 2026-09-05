import { prisma } from '../lib/prisma';

/**
 * Generates a unique tracking number in format: LF-YYYYMMDD-XXXXXXXX
 * e.g. LF-20260905-A3F7B2C1
 * Retries up to 5 times if collision detected (statistically negligible with 8 hex chars)
 */
export async function generateTrackingNumber(): Promise<string> {
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = Math.random().toString(16).substring(2, 10).toUpperCase().padEnd(8, '0');
    const trackingNumber = `LF-${datePart}-${randomPart}`;

    const existing = await prisma.shipment.findUnique({
      where: { trackingNumber },
      select: { id: true },
    });

    if (!existing) return trackingNumber;
  }

  throw new Error('Failed to generate unique tracking number after maximum attempts');
}
