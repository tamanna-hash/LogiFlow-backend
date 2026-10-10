/**
 * fix-missing-profiles.ts
 * 
 * One-time migration script to fix users who have been assigned roles
 * but don't have the corresponding profile records.
 * 
 * This commonly happens when:
 * 1. A user is created via Google OAuth (CUSTOMER role by default)
 * 2. An admin changes their role to HUB_MANAGER or COURIER
 * 3. The profile record was never created
 * 
 * Run with: npx tsx scripts/fix-missing-profiles.ts
 */

import { config } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma';

// Load environment variables
config();

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Scanning for users with missing profiles...\n');

  // Find all HUB_MANAGERs without profiles
  const hubManagers = await prisma.user.findMany({
    where: {
      role: 'HUB_MANAGER',
      deletedAt: null,
    },
    include: {
      hubManagerProfile: true,
    },
  });

  const hubManagersMissing = hubManagers.filter(u => !u.hubManagerProfile);
  console.log(`Found ${hubManagersMissing.length} HUB_MANAGER users without profiles`);

  // Find all COURIERs without profiles
  const couriers = await prisma.user.findMany({
    where: {
      role: 'COURIER',
      deletedAt: null,
    },
    include: {
      courierProfile: true,
    },
  });

  const couriersMissing = couriers.filter(u => !u.courierProfile);
  console.log(`Found ${couriersMissing.length} COURIER users without profiles`);

  // Find all CUSTOMERs without profiles
  const customers = await prisma.user.findMany({
    where: {
      role: 'CUSTOMER',
      deletedAt: null,
    },
    include: {
      customerProfile: true,
    },
  });

  const customersMissing = customers.filter(u => !u.customerProfile);
  console.log(`Found ${customersMissing.length} CUSTOMER users without profiles\n`);

  // Fix them
  let fixed = 0;

  for (const user of hubManagersMissing) {
    console.log(`Creating HubManagerProfile for ${user.email}...`);
    await prisma.hubManagerProfile.create({
      data: { userId: user.id },
    });
    fixed++;
  }

  for (const user of couriersMissing) {
    console.log(`Creating CourierProfile for ${user.email}...`);
    await prisma.courierProfile.create({
      data: { userId: user.id },
    });
    fixed++;
  }

  for (const user of customersMissing) {
    console.log(`Creating CustomerProfile for ${user.email}...`);
    await prisma.customerProfile.create({
      data: { userId: user.id },
    });
    fixed++;
  }

  console.log(`\n✅ Fixed ${fixed} missing profiles`);

  // Summary
  console.log('\n📊 Summary:');
  console.log(`   HUB_MANAGER profiles created: ${hubManagersMissing.length}`);
  console.log(`   COURIER profiles created: ${couriersMissing.length}`);
  console.log(`   CUSTOMER profiles created: ${customersMissing.length}`);
}

main()
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
