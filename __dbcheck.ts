import { prisma } from './src/app/lib/prisma';

async function main() {
  // Count all major tables
  const counts = {
    users: await prisma.user.count({ where: { deletedAt: null } }),
    shipments: await prisma.shipment.count(),
    hubs: await prisma.hub.count({ where: { deletedAt: null } }),
    zones: await prisma.zone.count(),
    pricingRules: await prisma.pricingRule.count({ where: { isActive: true } }),
    courierAssignments: await prisma.courierAssignment.count(),
    pickupRequests: await prisma.pickupRequest.count(),
    deliveryAttempts: await prisma.deliveryAttempt.count(),
    hubTransfers: await prisma.hubTransfer.count(),
    payments: await prisma.payment.count(),
    auditLogs: await prisma.auditLog.count(),
    notifications: await prisma.notification.count(),
  };
  console.log('COUNTS:', JSON.stringify(counts, null, 2));

  // Zones for shipment creation
  const zones = await prisma.zone.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true, hubId: true },
    take: 3,
  });
  console.log('ZONES:', JSON.stringify(zones));

  // Get ALL users with their roles to see credentials needed
  const allUsers = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, email: true, role: true, isActive: true },
    orderBy: { role: 'asc' },
  });
  console.log('\nALL USERS:');
  for (const user of allUsers) {
    console.log(`  ${user.role.padEnd(15)} ${user.email.padEnd(40)} active: ${user.isActive}`);
  }

  // Courier with profile
  const courierUser = await prisma.user.findFirst({
    where: { role: 'COURIER', deletedAt: null, isActive: true },
    select: {
      id: true, email: true,
      courierProfile: { select: { id: true, availability: true, hubId: true } },
    },
  });
  console.log('COURIER:', JSON.stringify(courierUser));

  // Sample recent shipment
  const shipment = await prisma.shipment.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, trackingNumber: true, status: true, customerId: true, createdAt: true },
  });
  console.log('LATEST_SHIPMENT:', JSON.stringify(shipment));

  // Check pricing rules
  const pricingRules = await prisma.pricingRule.findMany({
    where: { isActive: true },
    select: { id: true, name: true, basePrice: true, pricePerKg: true },
    take: 3,
  });
  console.log('PRICING_RULES:', JSON.stringify(pricingRules));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
