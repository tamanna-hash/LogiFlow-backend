/**
 * LogiFlow Demo Seed
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates a complete, interconnected demo environment for all five roles.
 *
 * SAFETY:
 *  • Uses upsert / createMany(skipDuplicates) — safe to rerun
 *  • Refuses to run if NODE_ENV=production
 *  • Never stores plaintext passwords (uses the same argon2 hasher as registration)
 *  • No real bKash/Stripe transactions are created
 *  • Simulated payment records are clearly identified in metadata
 *
 * USAGE:
 *   npm run db:seed           (runs this file)
 *   npm run db:seed:demo      (alias for same)
 *
 * DEMO CREDENTIALS (printed at end):
 *   All demo accounts use the password: Demo@LogiFlow2026
 */

import 'dotenv/config';
import { PrismaClient } from '../generated/prisma';
import argon2 from 'argon2';

// ── Guards ────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  console.error('❌  Seed refused: NODE_ENV=production. Demo seeding must never run against production.');
  process.exit(1);
}

const prisma = new PrismaClient();

// ── Constants ─────────────────────────────────────────────────────────────────

const DEMO_PASSWORD = 'Demo@LogiFlow2026';
const SEED_DATE = new Date('2026-09-01T08:00:00.000Z');

// Fixed CUIDs keep seeding idempotent across reruns
// Hub IDs are resolved at runtime (upserted by name) and written back here
const IDS = {
  // Hubs — resolved after upsert
  hubDhaka:    '',
  hubCumilla:  '',
  hubCTG:      '',

  // Zones — resolved after upsert
  zoneDhakaNorth:  '',
  zoneDhakaSouth:  '',
  zoneCumillaMain: '',
  zoneCTGPort:     '',
  zoneCTGCity:     '',

  // Users — resolved after upsert
  admin:     '',
  ops:       '',
  hubMgr1:   '',
  hubMgr2:   '',
  courier1:  '',
  courier2:  '',
  courier3:  '',
  courier4:  '',
  customer1: '',
  customer2: '',
  customer3: '',
  customer4: '',
  customer5: '',

  // Courier profiles — resolved after upsert
  cpCourier1: '',
  cpCourier2: '',
  cpCourier3: '',
  cpCourier4: '',

  // Pricing rules (stable, upserted by id)
  prDefault:   'pr_default_logiflow1',
  prExpress:   'pr_express_logiflow2',
  prSameDay:   'pr_sameday_logiflo3',
  prFragile:   'pr_fragile_logiflo4',

  // Shipments (stable tracking numbers, upserted by trackingNumber)
  s1: '', s2: '', s3: '', s4: '', s5: '', s6: '', s7: '',
  s8: '', s9: '', s10: '', s11: '', s12: '', s13: '',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function hashDemoPassword(): Promise<string> {
  return argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
}

function daysAgo(n: number): Date {
  const d = new Date(SEED_DATE);
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n: number): Date {
  const d = new Date(SEED_DATE);
  d.setHours(d.getHours() - n);
  return d;
}

// ── Main seed function ────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  LogiFlow demo seed starting…');
  console.log(`   Target: ${process.env.DATABASE_URL?.split('@')[1] ?? 'database'}`);
  console.log('   Password hash: computing…');

  const passwordHash = await hashDemoPassword();
  console.log('   Password hash: done ✓');

  // ── 1. Hubs ─────────────────────────────────────────────────────────────────
  console.log('\n📦  Seeding hubs…');

  const hubDhaka = await prisma.hub.upsert({
    where: { name: 'Dhaka Central Hub' },
    update: {},
    create: {
      name: 'Dhaka Central Hub', code: 'DHK-C',
      address: 'Tejgaon Industrial Area, Dhaka-1215',
      city: 'Dhaka', phone: '+8801700000001', isActive: true, createdAt: daysAgo(60),
    },
    select: { id: true },
  });

  const hubCumilla = await prisma.hub.upsert({
    where: { name: 'Cumilla Regional Hub' },
    update: {},
    create: {
      name: 'Cumilla Regional Hub', code: 'CML-R',
      address: 'Kandirpar, Cumilla-3500',
      city: 'Cumilla', phone: '+8801700000002', isActive: true, createdAt: daysAgo(55),
    },
    select: { id: true },
  });

  const hubCTG = await prisma.hub.upsert({
    where: { name: 'Chattogram Port Hub' },
    update: {},
    create: {
      name: 'Chattogram Port Hub', code: 'CTG-P',
      address: 'Agrabad Commercial Area, Chattogram-4100',
      city: 'Chattogram', phone: '+8801700000003', isActive: true, createdAt: daysAgo(50),
    },
    select: { id: true },
  });

  // Resolve hub IDs (use actual DB IDs, not fixed seed strings)
  IDS.hubDhaka   = hubDhaka.id;
  IDS.hubCumilla = hubCumilla.id;
  IDS.hubCTG     = hubCTG.id;
  console.log('🗺️   Seeding zones…');

  const zonesData = [
    { id: IDS.zoneDhakaNorth, name: 'Dhaka North', code: 'ZN-DHK-N', hubId: IDS.hubDhaka, description: 'Uttara, Mirpur, Gulshan' },
    { id: IDS.zoneDhakaSouth, name: 'Dhaka South', code: 'ZN-DHK-S', hubId: IDS.hubDhaka, description: 'Old Dhaka, Sadarghat, Dhanmondi' },
    { id: IDS.zoneCumillaMain, name: 'Cumilla Main', code: 'ZN-CML-M', hubId: IDS.hubCumilla, description: 'Cumilla city and suburbs' },
    { id: IDS.zoneCTGPort, name: 'Chattogram Port Zone', code: 'ZN-CTG-P', hubId: IDS.hubCTG, description: 'Port area, Agrabad, Patenga' },
    { id: IDS.zoneCTGCity, name: 'Chattogram City', code: 'ZN-CTG-C', hubId: IDS.hubCTG, description: 'Nasirabad, GEC, Khulshi' },
  ];

  for (const z of zonesData) {
    const zone = await prisma.zone.upsert({
      where: { code: z.code },
      update: {},
      create: { name: z.name, code: z.code, hubId: z.hubId, description: z.description, isActive: true },
      select: { id: true, code: true },
    });
    // Resolve zone IDs back into IDS
    if (z.code === 'ZN-DHK-N') IDS.zoneDhakaNorth  = zone.id;
    if (z.code === 'ZN-DHK-S') IDS.zoneDhakaSouth  = zone.id;
    if (z.code === 'ZN-CML-M') IDS.zoneCumillaMain = zone.id;
    if (z.code === 'ZN-CTG-P') IDS.zoneCTGPort     = zone.id;
    if (z.code === 'ZN-CTG-C') IDS.zoneCTGCity     = zone.id;
  }

  // ── 3. Users ─────────────────────────────────────────────────────────────────
  console.log('👤  Seeding users…');

  const usersData = [
    { firstName: 'Admin',    lastName: 'LogiFlow',   email: 'admin@demo.logiflow.app',     role: 'ADMIN' as const },
    { firstName: 'Nadia',    lastName: 'Rahman',     email: 'ops@demo.logiflow.app',        role: 'OPERATIONS_MANAGER' as const },
    { firstName: 'Karim',    lastName: 'Hussain',    email: 'hub.dhaka@demo.logiflow.app',  role: 'HUB_MANAGER' as const },
    { firstName: 'Dilruba',  lastName: 'Akhter',     email: 'hub.ctg@demo.logiflow.app',   role: 'HUB_MANAGER' as const },
    { firstName: 'Rafiq',    lastName: 'Islam',      email: 'courier1@demo.logiflow.app',  role: 'COURIER' as const, phone: '01811000001' },
    { firstName: 'Salam',    lastName: 'Mia',        email: 'courier2@demo.logiflow.app',  role: 'COURIER' as const, phone: '01811000002' },
    { firstName: 'Jakir',    lastName: 'Hossain',    email: 'courier3@demo.logiflow.app',  role: 'COURIER' as const, phone: '01811000003' },
    { firstName: 'Mitu',     lastName: 'Begum',      email: 'courier4@demo.logiflow.app',  role: 'COURIER' as const, phone: '01811000004' },
    { firstName: 'Arif',     lastName: 'Hasan',      email: 'customer1@demo.logiflow.app', role: 'CUSTOMER' as const, phone: '01911000001' },
    { firstName: 'Mitu',     lastName: 'Khatun',     email: 'customer2@demo.logiflow.app', role: 'CUSTOMER' as const, phone: '01911000002' },
    { firstName: 'Rubel',    lastName: 'Chowdhury',  email: 'customer3@demo.logiflow.app', role: 'CUSTOMER' as const, phone: '01911000003' },
    { firstName: 'Sonia',    lastName: 'Islam',      email: 'customer4@demo.logiflow.app', role: 'CUSTOMER' as const, phone: '01911000004' },
    { firstName: 'Tarek',    lastName: 'Ahmed',      email: 'customer5@demo.logiflow.app', role: 'CUSTOMER' as const, phone: '01911000005' },
  ];

  for (const u of usersData) {
    const created = await prisma.user.upsert({
      where: { email: u.email },
      update: { passwordHash },
      create: {
        email: u.email, passwordHash,
        firstName: u.firstName, lastName: u.lastName,
        phone: (u as { phone?: string }).phone ?? null,
        role: u.role, isEmailVerified: true, isActive: true, createdAt: daysAgo(30),
      },
      select: { id: true, email: true },
    });
    // Write actual DB id back into IDS so downstream seeds use the correct FK
    switch (u.email) {
      case 'admin@demo.logiflow.app':          IDS.admin     = created.id; break;
      case 'ops@demo.logiflow.app':            IDS.ops       = created.id; break;
      case 'hub.dhaka@demo.logiflow.app':      IDS.hubMgr1   = created.id; break;
      case 'hub.ctg@demo.logiflow.app':        IDS.hubMgr2   = created.id; break;
      case 'courier1@demo.logiflow.app':       IDS.courier1  = created.id; break;
      case 'courier2@demo.logiflow.app':       IDS.courier2  = created.id; break;
      case 'courier3@demo.logiflow.app':       IDS.courier3  = created.id; break;
      case 'courier4@demo.logiflow.app':       IDS.courier4  = created.id; break;
      case 'customer1@demo.logiflow.app':      IDS.customer1 = created.id; break;
      case 'customer2@demo.logiflow.app':      IDS.customer2 = created.id; break;
      case 'customer3@demo.logiflow.app':      IDS.customer3 = created.id; break;
      case 'customer4@demo.logiflow.app':      IDS.customer4 = created.id; break;
      case 'customer5@demo.logiflow.app':      IDS.customer5 = created.id; break;
    }
  }

  // ── 4. Role profiles ──────────────────────────────────────────────────────────
  console.log('🔗  Seeding role profiles…');

  // Customer profiles
  for (const [id, address, city] of [
    [IDS.customer1, 'House 5, Road 12, Dhanmondi', 'Dhaka'],
    [IDS.customer2, 'Flat 3B, Mirpur-10', 'Dhaka'],
    [IDS.customer3, 'Panchlaish, Chattogram', 'Chattogram'],
    [IDS.customer4, 'Kotwali, Cumilla', 'Cumilla'],
    [IDS.customer5, 'Gulshan Avenue, Dhaka', 'Dhaka'],
  ] as [string, string, string][]) {
    await prisma.customerProfile.upsert({
      where: { userId: id },
      update: {},
      create: { userId: id, defaultAddress: address, city, postalCode: '1200' },
    });
  }

  // Courier profiles
  const courierProfilesData = [
    { userId: IDS.courier1, hubId: IDS.hubDhaka, vehicleType: 'Motorcycle', vehicleNumber: 'Dhaka Metro GA-11-1234', availability: 'AVAILABLE' as const, totalDeliveries: 47 },
    { userId: IDS.courier2, hubId: IDS.hubDhaka, vehicleType: 'Motorcycle', vehicleNumber: 'Dhaka Metro GA-11-5678', availability: 'AVAILABLE' as const, totalDeliveries: 23 },
    { userId: IDS.courier3, hubId: IDS.hubCTG,   vehicleType: 'Bicycle',    vehicleNumber: 'CTG-BC-0001',           availability: 'AVAILABLE' as const, totalDeliveries: 12 },
    { userId: IDS.courier4, hubId: IDS.hubCTG,   vehicleType: 'Motorcycle', vehicleNumber: 'CTG Metro CHA-11-9012', availability: 'AVAILABLE' as const, totalDeliveries: 31 },
  ];

  for (const cp of courierProfilesData) {
    const created = await prisma.courierProfile.upsert({
      where: { userId: cp.userId },
      update: { totalDeliveries: cp.totalDeliveries },
      create: cp,
      select: { id: true, userId: true },
    });
    if (cp.userId === IDS.courier1) IDS.cpCourier1 = created.id;
    if (cp.userId === IDS.courier2) IDS.cpCourier2 = created.id;
    if (cp.userId === IDS.courier3) IDS.cpCourier3 = created.id;
    if (cp.userId === IDS.courier4) IDS.cpCourier4 = created.id;
  }

  // Hub manager profiles
  await prisma.hubManagerProfile.upsert({
    where: { userId: IDS.hubMgr1 },
    update: {},
    create: { userId: IDS.hubMgr1, hubId: IDS.hubDhaka },
  });

  await prisma.hubManagerProfile.upsert({
    where: { userId: IDS.hubMgr2 },
    update: {},
    create: { userId: IDS.hubMgr2, hubId: IDS.hubCTG },
  });

  // ── 5. Pricing rules ──────────────────────────────────────────────────────────
  console.log('💰  Seeding pricing rules…');

  await prisma.pricingRule.upsert({
    where: { id: IDS.prDefault },
    update: {},
    create: {
      id: IDS.prDefault,
      name: 'Standard Default Rate',
      deliveryType: null, parcelType: null,
      originZoneId: null, destinationZoneId: null,
      basePrice: 80.00, pricePerKg: 15.00, baseWeightKg: 1.0,
      zoneSurcharge: 0, deliveryTypeSurcharge: 0,
      isDefault: true, isActive: true,
    },
  });

  await prisma.pricingRule.upsert({
    where: { id: IDS.prExpress },
    update: {},
    create: {
      id: IDS.prExpress,
      name: 'Express Surcharge',
      deliveryType: 'EXPRESS', parcelType: null,
      originZoneId: null, destinationZoneId: null,
      basePrice: 80.00, pricePerKg: 15.00, baseWeightKg: 1.0,
      zoneSurcharge: 0, deliveryTypeSurcharge: 50.00,
      isDefault: false, isActive: true,
    },
  });

  await prisma.pricingRule.upsert({
    where: { id: IDS.prSameDay },
    update: {},
    create: {
      id: IDS.prSameDay,
      name: 'Same Day Surcharge',
      deliveryType: 'SAME_DAY', parcelType: null,
      originZoneId: null, destinationZoneId: null,
      basePrice: 80.00, pricePerKg: 15.00, baseWeightKg: 1.0,
      zoneSurcharge: 0, deliveryTypeSurcharge: 120.00,
      isDefault: false, isActive: true,
    },
  });

  await prisma.pricingRule.upsert({
    where: { id: IDS.prFragile },
    update: {},
    create: {
      id: IDS.prFragile,
      name: 'Fragile Item Premium',
      deliveryType: null, parcelType: 'FRAGILE',
      originZoneId: null, destinationZoneId: null,
      basePrice: 100.00, pricePerKg: 20.00, baseWeightKg: 1.0,
      zoneSurcharge: 30.00, deliveryTypeSurcharge: 0,
      isDefault: false, isActive: true,
    },
  });

  // ── 6. Shipments ──────────────────────────────────────────────────────────────
  console.log('📬  Seeding shipments…');

  type ShipmentSeed = {
    trackingNumber: string;
    customerId: string;
    status: string;
    paymentStatus: string;
    senderName: string; senderPhone: string; senderAddress: string; senderCity: string;
    originZoneId: string;
    recipientName: string; recipientPhone: string; recipientAddress: string; recipientCity: string;
    destinationZoneId: string;
    deliveryType: string; parcelType: string;
    declaredWeightKg: number;
    price: number;
    description?: string;
    currentHubId?: string;
    deliveryAttemptCount?: number;
    deliveredAt?: Date;
    cancelledAt?: Date;
    cancellationReason?: string;
    createdAt: Date;
    updatedAt: Date;
  };

  const shipmentsData: ShipmentSeed[] = [
    // CREATED — awaiting payment
    {
      trackingNumber: 'LF-20260901-DEMO0001',
      customerId: IDS.customer1, status: 'CREATED', paymentStatus: 'PENDING',
      senderName: 'Arif Hasan', senderPhone: '01911000001', senderAddress: 'House 5 Road 12 Dhanmondi', senderCity: 'Dhaka', originZoneId: IDS.zoneDhakaSouth,
      recipientName: 'Rubel Chowdhury', recipientPhone: '01911000003', recipientAddress: 'Panchlaish Chattogram', recipientCity: 'Chattogram', destinationZoneId: IDS.zoneCTGCity,
      deliveryType: 'STANDARD', parcelType: 'REGULAR', declaredWeightKg: 2.0, price: 110.00,
      description: 'Books and stationery',
      createdAt: daysAgo(3), updatedAt: daysAgo(3),
    },
    // PICKUP_REQUESTED — payment done
    {
      trackingNumber: 'LF-20260901-DEMO0002',
      customerId: IDS.customer2, status: 'PICKUP_REQUESTED', paymentStatus: 'COMPLETED',
      senderName: 'Mitu Khatun', senderPhone: '01911000002', senderAddress: 'Mirpur-10 Dhaka', senderCity: 'Dhaka', originZoneId: IDS.zoneDhakaNorth,
      recipientName: 'Tarek Ahmed', recipientPhone: '01911000005', recipientAddress: 'Gulshan Ave Dhaka', recipientCity: 'Dhaka', destinationZoneId: IDS.zoneDhakaNorth,
      deliveryType: 'EXPRESS', parcelType: 'REGULAR', declaredWeightKg: 0.5, price: 130.00,
      description: 'Mobile phone accessories',
      createdAt: daysAgo(4), updatedAt: daysAgo(2),
    },
    // ASSIGNED — courier assigned
    {
      trackingNumber: 'LF-20260901-DEMO0003',
      customerId: IDS.customer3, status: 'ASSIGNED', paymentStatus: 'COMPLETED',
      senderName: 'Rubel Chowdhury', senderPhone: '01911000003', senderAddress: 'Nasirabad Chattogram', senderCity: 'Chattogram', originZoneId: IDS.zoneCTGCity,
      recipientName: 'Sonia Islam', recipientPhone: '01911000004', recipientAddress: 'Kotwali Cumilla', recipientCity: 'Cumilla', destinationZoneId: IDS.zoneCumillaMain,
      deliveryType: 'STANDARD', parcelType: 'FRAGILE', declaredWeightKg: 1.5, price: 150.00,
      description: 'Ceramic gifts',
      createdAt: daysAgo(5), updatedAt: daysAgo(1),
    },
    // PICKED_UP
    {
      trackingNumber: 'LF-20260901-DEMO0004',
      customerId: IDS.customer1, status: 'PICKED_UP', paymentStatus: 'COMPLETED',
      senderName: 'Arif Hasan', senderPhone: '01911000001', senderAddress: 'Dhanmondi Dhaka', senderCity: 'Dhaka', originZoneId: IDS.zoneDhakaSouth,
      recipientName: 'Karim Hussain', recipientPhone: '01711000001', recipientAddress: 'Tejgaon Dhaka', recipientCity: 'Dhaka', destinationZoneId: IDS.zoneDhakaNorth,
      deliveryType: 'SAME_DAY', parcelType: 'DOCUMENT', declaredWeightKg: 0.3, price: 200.00,
      description: 'Legal documents',
      createdAt: daysAgo(1), updatedAt: hoursAgo(4),
    },
    // IN_TRANSIT (hub-to-hub)
    {
      trackingNumber: 'LF-20260901-DEMO0005',
      customerId: IDS.customer4, status: 'IN_TRANSIT', paymentStatus: 'COMPLETED',
      senderName: 'Sonia Islam', senderPhone: '01911000004', senderAddress: 'Kotwali Cumilla', senderCity: 'Cumilla', originZoneId: IDS.zoneCumillaMain,
      recipientName: 'Mitu Khatun', recipientPhone: '01911000002', recipientAddress: 'Mirpur Dhaka', recipientCity: 'Dhaka', destinationZoneId: IDS.zoneDhakaNorth,
      deliveryType: 'STANDARD', parcelType: 'REGULAR', declaredWeightKg: 3.0, price: 125.00,
      description: 'Clothing items',
      createdAt: daysAgo(6), updatedAt: daysAgo(2),
    },
    // AT_DESTINATION_HUB
    {
      trackingNumber: 'LF-20260901-DEMO0006',
      customerId: IDS.customer5, status: 'AT_DESTINATION_HUB', paymentStatus: 'COMPLETED',
      senderName: 'Tarek Ahmed', senderPhone: '01911000005', senderAddress: 'Gulshan Dhaka', senderCity: 'Dhaka', originZoneId: IDS.zoneDhakaNorth,
      recipientName: 'Dilruba Akhter', recipientPhone: '01711000002', recipientAddress: 'Agrabad Chattogram', recipientCity: 'Chattogram', destinationZoneId: IDS.zoneCTGPort,
      deliveryType: 'EXPRESS', parcelType: 'OVERSIZED', declaredWeightKg: 8.0, price: 280.00,
      description: 'Electronics equipment',
      currentHubId: IDS.hubCTG,
      createdAt: daysAgo(7), updatedAt: daysAgo(1),
    },
    // OUT_FOR_DELIVERY
    {
      trackingNumber: 'LF-20260901-DEMO0007',
      customerId: IDS.customer2, status: 'OUT_FOR_DELIVERY', paymentStatus: 'COMPLETED',
      senderName: 'Mitu Khatun', senderPhone: '01911000002', senderAddress: 'Mirpur Dhaka', senderCity: 'Dhaka', originZoneId: IDS.zoneDhakaNorth,
      recipientName: 'Arif Hasan', recipientPhone: '01911000001', recipientAddress: 'Dhanmondi Dhaka', recipientCity: 'Dhaka', destinationZoneId: IDS.zoneDhakaSouth,
      deliveryType: 'STANDARD', parcelType: 'REGULAR', declaredWeightKg: 1.2, price: 95.00,
      description: 'Household items',
      createdAt: daysAgo(8), updatedAt: hoursAgo(2),
    },
    // DELIVERED
    {
      trackingNumber: 'LF-20260901-DEMO0008',
      customerId: IDS.customer3, status: 'DELIVERED', paymentStatus: 'COMPLETED',
      senderName: 'Rubel Chowdhury', senderPhone: '01911000003', senderAddress: 'Panchlaish CTG', senderCity: 'Chattogram', originZoneId: IDS.zoneCTGCity,
      recipientName: 'Sonia Islam', recipientPhone: '01911000004', recipientAddress: 'Kotwali Cumilla', recipientCity: 'Cumilla', destinationZoneId: IDS.zoneCumillaMain,
      deliveryType: 'STANDARD', parcelType: 'REGULAR', declaredWeightKg: 2.5, price: 120.00,
      description: 'Food items',
      deliveredAt: daysAgo(1),
      createdAt: daysAgo(10), updatedAt: daysAgo(1),
    },
    // DELIVERY_FAILED
    {
      trackingNumber: 'LF-20260901-DEMO0009',
      customerId: IDS.customer4, status: 'DELIVERY_FAILED', paymentStatus: 'COMPLETED',
      senderName: 'Sonia Islam', senderPhone: '01911000004', senderAddress: 'Cumilla', senderCity: 'Cumilla', originZoneId: IDS.zoneCumillaMain,
      recipientName: 'Tarek Ahmed', recipientPhone: '01911000005', recipientAddress: 'Gulshan Dhaka', recipientCity: 'Dhaka', destinationZoneId: IDS.zoneDhakaNorth,
      deliveryType: 'STANDARD', parcelType: 'REGULAR', declaredWeightKg: 1.0, price: 90.00,
      description: 'Medicines',
      deliveryAttemptCount: 1,
      createdAt: daysAgo(12), updatedAt: daysAgo(2),
    },
    // CANCELLED
    {
      trackingNumber: 'LF-20260901-DEMO0010',
      customerId: IDS.customer1, status: 'CANCELLED', paymentStatus: 'PENDING',
      senderName: 'Arif Hasan', senderPhone: '01911000001', senderAddress: 'Dhaka', senderCity: 'Dhaka', originZoneId: IDS.zoneDhakaSouth,
      recipientName: 'Mitu Khatun', recipientPhone: '01911000002', recipientAddress: 'Mirpur Dhaka', recipientCity: 'Dhaka', destinationZoneId: IDS.zoneDhakaNorth,
      deliveryType: 'STANDARD', parcelType: 'DOCUMENT', declaredWeightKg: 0.2, price: 80.00,
      cancelledAt: daysAgo(5),
      cancellationReason: 'Changed my mind — demo cancellation',
      createdAt: daysAgo(15), updatedAt: daysAgo(5),
    },
    // RETURN_INITIATED
    {
      trackingNumber: 'LF-20260901-DEMO0011',
      customerId: IDS.customer5, status: 'RETURN_INITIATED', paymentStatus: 'COMPLETED',
      senderName: 'Tarek Ahmed', senderPhone: '01911000005', senderAddress: 'Gulshan Dhaka', senderCity: 'Dhaka', originZoneId: IDS.zoneDhakaNorth,
      recipientName: 'Rubel Chowdhury', recipientPhone: '01911000003', recipientAddress: 'Chattogram', recipientCity: 'Chattogram', destinationZoneId: IDS.zoneCTGCity,
      deliveryType: 'STANDARD', parcelType: 'FRAGILE', declaredWeightKg: 2.0, price: 150.00,
      description: 'Glass items — returned due to breakage',
      deliveryAttemptCount: 2,
      createdAt: daysAgo(14), updatedAt: daysAgo(3),
    },
    // Additional CREATED shipments for pagination demos
    {
      trackingNumber: 'LF-20260901-DEMO0012',
      customerId: IDS.customer2, status: 'CREATED', paymentStatus: 'PENDING',
      senderName: 'Mitu Khatun', senderPhone: '01911000002', senderAddress: 'Mirpur Dhaka', senderCity: 'Dhaka', originZoneId: IDS.zoneDhakaNorth,
      recipientName: 'Arif Hasan', recipientPhone: '01911000001', recipientAddress: 'Dhanmondi Dhaka', recipientCity: 'Dhaka', destinationZoneId: IDS.zoneDhakaSouth,
      deliveryType: 'EXPRESS', parcelType: 'REGULAR', declaredWeightKg: 1.5, price: 130.00,
      createdAt: daysAgo(2), updatedAt: daysAgo(2),
    },
    {
      trackingNumber: 'LF-20260901-DEMO0013',
      customerId: IDS.customer3, status: 'CREATED', paymentStatus: 'PENDING',
      senderName: 'Rubel Chowdhury', senderPhone: '01911000003', senderAddress: 'Panchlaish CTG', senderCity: 'Chattogram', originZoneId: IDS.zoneCTGCity,
      recipientName: 'Tarek Ahmed', recipientPhone: '01911000005', recipientAddress: 'Gulshan Dhaka', recipientCity: 'Dhaka', destinationZoneId: IDS.zoneDhakaNorth,
      deliveryType: 'STANDARD', parcelType: 'REGULAR', declaredWeightKg: 4.0, price: 140.00,
      createdAt: daysAgo(1), updatedAt: daysAgo(1),
    },
  ];

  for (const s of shipmentsData) {
    const shipment = await prisma.shipment.upsert({
      where: { trackingNumber: s.trackingNumber },
      update: { status: s.status as never, updatedAt: s.updatedAt },
      create: {
        trackingNumber: s.trackingNumber,
        customerId: s.customerId,
        status: s.status as never,
        paymentStatus: s.paymentStatus as never,
        senderName: s.senderName, senderPhone: s.senderPhone,
        senderAddress: s.senderAddress, senderCity: s.senderCity,
        originZoneId: s.originZoneId,
        recipientName: s.recipientName, recipientPhone: s.recipientPhone,
        recipientAddress: s.recipientAddress, recipientCity: s.recipientCity,
        destinationZoneId: s.destinationZoneId,
        deliveryType: s.deliveryType as never,
        parcelType: s.parcelType as never,
        declaredWeightKg: s.declaredWeightKg,
        price: s.price,
        description: s.description,
        currentHubId: s.currentHubId,
        deliveryAttemptCount: s.deliveryAttemptCount ?? 0,
        deliveredAt: s.deliveredAt,
        cancelledAt: s.cancelledAt,
        cancellationReason: s.cancellationReason,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      },
      select: { id: true, trackingNumber: true },
    });
    // Resolve shipment IDs back into IDS
    switch (s.trackingNumber) {
      case 'LF-20260901-DEMO0001': IDS.s1  = shipment.id; break;
      case 'LF-20260901-DEMO0002': IDS.s2  = shipment.id; break;
      case 'LF-20260901-DEMO0003': IDS.s3  = shipment.id; break;
      case 'LF-20260901-DEMO0004': IDS.s4  = shipment.id; break;
      case 'LF-20260901-DEMO0005': IDS.s5  = shipment.id; break;
      case 'LF-20260901-DEMO0006': IDS.s6  = shipment.id; break;
      case 'LF-20260901-DEMO0007': IDS.s7  = shipment.id; break;
      case 'LF-20260901-DEMO0008': IDS.s8  = shipment.id; break;
      case 'LF-20260901-DEMO0009': IDS.s9  = shipment.id; break;
      case 'LF-20260901-DEMO0010': IDS.s10 = shipment.id; break;
      case 'LF-20260901-DEMO0011': IDS.s11 = shipment.id; break;
      case 'LF-20260901-DEMO0012': IDS.s12 = shipment.id; break;
      case 'LF-20260901-DEMO0013': IDS.s13 = shipment.id; break;
    }
  }

  // ── 7. Shipment items ─────────────────────────────────────────────────────────
  console.log('📦  Seeding shipment items…');

  const itemsData = [
    { shipmentId: IDS.s1, description: 'Textbooks', weightKg: 1.5, quantity: 3 },
    { shipmentId: IDS.s1, description: 'Notebooks', weightKg: 0.5, quantity: 5 },
    { shipmentId: IDS.s2, description: 'Phone case', weightKg: 0.1, quantity: 1 },
    { shipmentId: IDS.s2, description: 'Charger', weightKg: 0.4, quantity: 1 },
    { shipmentId: IDS.s3, description: 'Ceramic vase', weightKg: 1.5, quantity: 1, parcelType: 'FRAGILE' as const },
    { shipmentId: IDS.s4, description: 'Legal contract', weightKg: 0.3, quantity: 1, parcelType: 'DOCUMENT' as const },
    { shipmentId: IDS.s5, description: 'T-shirts', weightKg: 1.0, quantity: 3 },
    { shipmentId: IDS.s5, description: 'Trousers', weightKg: 2.0, quantity: 2 },
    { shipmentId: IDS.s6, description: 'Laptop', weightKg: 2.5, quantity: 1, parcelType: 'FRAGILE' as const },
    { shipmentId: IDS.s6, description: 'Monitor', weightKg: 5.5, quantity: 1, parcelType: 'FRAGILE' as const },
    { shipmentId: IDS.s7, description: 'Kitchen utensils', weightKg: 1.2, quantity: 1 },
    { shipmentId: IDS.s8, description: 'Dried fish', weightKg: 2.5, quantity: 1 },
    { shipmentId: IDS.s9, description: 'Medicine box', weightKg: 1.0, quantity: 1 },
    { shipmentId: IDS.s10, description: 'Invoice', weightKg: 0.2, quantity: 1, parcelType: 'DOCUMENT' as const },
    { shipmentId: IDS.s11, description: 'Glass frame', weightKg: 2.0, quantity: 1, parcelType: 'FRAGILE' as const },
    { shipmentId: IDS.s12, description: 'Clothing bundle', weightKg: 1.5, quantity: 1 },
    { shipmentId: IDS.s13, description: 'Electronics parts', weightKg: 4.0, quantity: 1 },
  ];

  await prisma.shipmentItem.createMany({
    data: itemsData.map(item => ({
      ...item,
      parcelType: item.parcelType ?? 'REGULAR',
    })),
    skipDuplicates: true,
  });

  // ── 8. Tracking events ────────────────────────────────────────────────────────
  console.log('📡  Seeding tracking events…');

  const trackingEventsData = [
    // s1 CREATED
    { shipmentId: IDS.s1, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer1, createdAt: daysAgo(3) },
    // s2 flow
    { shipmentId: IDS.s2, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer2, createdAt: daysAgo(4) },
    { shipmentId: IDS.s2, status: 'PICKUP_REQUESTED', description: 'Pickup requested', actorId: IDS.customer2, createdAt: daysAgo(3) },
    // s3 flow
    { shipmentId: IDS.s3, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer3, createdAt: daysAgo(5) },
    { shipmentId: IDS.s3, status: 'PICKUP_REQUESTED', description: 'Pickup requested', actorId: IDS.customer3, createdAt: daysAgo(4) },
    { shipmentId: IDS.s3, status: 'ASSIGNED', description: 'Courier assigned for pickup', actorId: IDS.ops, createdAt: daysAgo(3) },
    // s4 flow
    { shipmentId: IDS.s4, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer1, createdAt: daysAgo(1) },
    { shipmentId: IDS.s4, status: 'PICKUP_REQUESTED', description: 'Pickup requested', actorId: IDS.customer1, createdAt: hoursAgo(10) },
    { shipmentId: IDS.s4, status: 'ASSIGNED', description: 'Courier assigned for pickup', actorId: IDS.ops, createdAt: hoursAgo(8) },
    { shipmentId: IDS.s4, status: 'PICKED_UP', description: 'Parcel picked up by courier', actorId: IDS.courier1, createdAt: hoursAgo(4) },
    // s5 flow
    { shipmentId: IDS.s5, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer4, createdAt: daysAgo(6) },
    { shipmentId: IDS.s5, status: 'PICKUP_REQUESTED', description: 'Pickup requested', actorId: IDS.customer4, createdAt: daysAgo(5) },
    { shipmentId: IDS.s5, status: 'ASSIGNED', description: 'Courier assigned for pickup', actorId: IDS.ops, createdAt: daysAgo(4) },
    { shipmentId: IDS.s5, status: 'PICKED_UP', description: 'Parcel picked up', actorId: IDS.courier3, createdAt: daysAgo(4) },
    { shipmentId: IDS.s5, status: 'AT_ORIGIN_HUB', description: 'Arrived at Cumilla Regional Hub', actorId: IDS.hubMgr2, location: 'Cumilla Regional Hub', createdAt: daysAgo(3) },
    { shipmentId: IDS.s5, status: 'IN_TRANSIT', description: 'Dispatched to Dhaka Central Hub', actorId: IDS.hubMgr1, createdAt: daysAgo(2) },
    // s6 flow
    { shipmentId: IDS.s6, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer5, createdAt: daysAgo(7) },
    { shipmentId: IDS.s6, status: 'PICKUP_REQUESTED', description: 'Pickup requested', actorId: IDS.customer5, createdAt: daysAgo(6) },
    { shipmentId: IDS.s6, status: 'ASSIGNED', description: 'Courier assigned for pickup', actorId: IDS.ops, createdAt: daysAgo(5) },
    { shipmentId: IDS.s6, status: 'PICKED_UP', description: 'Parcel picked up', actorId: IDS.courier1, createdAt: daysAgo(5) },
    { shipmentId: IDS.s6, status: 'AT_ORIGIN_HUB', description: 'Arrived at Dhaka Central Hub', actorId: IDS.hubMgr1, location: 'Dhaka Central Hub', createdAt: daysAgo(4) },
    { shipmentId: IDS.s6, status: 'IN_TRANSIT', description: 'Dispatched to Chattogram Port Hub', actorId: IDS.hubMgr1, createdAt: daysAgo(3) },
    { shipmentId: IDS.s6, status: 'AT_DESTINATION_HUB', description: 'Arrived at Chattogram Port Hub', actorId: IDS.hubMgr2, location: 'Chattogram Port Hub', createdAt: daysAgo(1) },
    // s7 flow
    { shipmentId: IDS.s7, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer2, createdAt: daysAgo(8) },
    { shipmentId: IDS.s7, status: 'PICKUP_REQUESTED', description: 'Pickup requested', actorId: IDS.customer2, createdAt: daysAgo(7) },
    { shipmentId: IDS.s7, status: 'ASSIGNED', description: 'Courier assigned for pickup', actorId: IDS.ops, createdAt: daysAgo(6) },
    { shipmentId: IDS.s7, status: 'PICKED_UP', description: 'Parcel picked up', actorId: IDS.courier2, createdAt: daysAgo(6) },
    { shipmentId: IDS.s7, status: 'AT_ORIGIN_HUB', description: 'Arrived at Dhaka Central Hub', actorId: IDS.hubMgr1, location: 'Dhaka Central Hub', createdAt: daysAgo(5) },
    { shipmentId: IDS.s7, status: 'AT_DESTINATION_HUB', description: 'Arrived at destination hub', actorId: IDS.hubMgr1, location: 'Dhaka Central Hub', createdAt: daysAgo(3) },
    { shipmentId: IDS.s7, status: 'OUT_FOR_DELIVERY', description: 'Courier assigned for delivery', actorId: IDS.ops, createdAt: hoursAgo(2) },
    // s8 — DELIVERED
    { shipmentId: IDS.s8, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer3, createdAt: daysAgo(10) },
    { shipmentId: IDS.s8, status: 'PICKUP_REQUESTED', description: 'Pickup requested', actorId: IDS.customer3, createdAt: daysAgo(9) },
    { shipmentId: IDS.s8, status: 'ASSIGNED', description: 'Courier assigned for pickup', actorId: IDS.ops, createdAt: daysAgo(8) },
    { shipmentId: IDS.s8, status: 'PICKED_UP', description: 'Parcel picked up', actorId: IDS.courier3, createdAt: daysAgo(8) },
    { shipmentId: IDS.s8, status: 'AT_ORIGIN_HUB', description: 'Arrived at Chattogram Port Hub', actorId: IDS.hubMgr2, location: 'Chattogram Port Hub', createdAt: daysAgo(7) },
    { shipmentId: IDS.s8, status: 'IN_TRANSIT', description: 'Dispatched to Cumilla Regional Hub', actorId: IDS.hubMgr2, createdAt: daysAgo(5) },
    { shipmentId: IDS.s8, status: 'AT_DESTINATION_HUB', description: 'Arrived at Cumilla Regional Hub', actorId: IDS.hubMgr2, location: 'Cumilla Regional Hub', createdAt: daysAgo(3) },
    { shipmentId: IDS.s8, status: 'OUT_FOR_DELIVERY', description: 'Out for delivery', actorId: IDS.ops, createdAt: daysAgo(2) },
    { shipmentId: IDS.s8, status: 'DELIVERED', description: 'Parcel delivered successfully', actorId: IDS.courier4, createdAt: daysAgo(1) },
    // s9 — DELIVERY_FAILED
    { shipmentId: IDS.s9, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer4, createdAt: daysAgo(12) },
    { shipmentId: IDS.s9, status: 'PICKUP_REQUESTED', description: 'Pickup requested', actorId: IDS.customer4, createdAt: daysAgo(11) },
    { shipmentId: IDS.s9, status: 'ASSIGNED', description: 'Courier assigned for pickup', actorId: IDS.ops, createdAt: daysAgo(10) },
    { shipmentId: IDS.s9, status: 'PICKED_UP', description: 'Parcel picked up', actorId: IDS.courier4, createdAt: daysAgo(10) },
    { shipmentId: IDS.s9, status: 'AT_ORIGIN_HUB', description: 'Arrived at hub', actorId: IDS.hubMgr2, location: 'Cumilla Regional Hub', createdAt: daysAgo(8) },
    { shipmentId: IDS.s9, status: 'AT_DESTINATION_HUB', description: 'Arrived at destination hub', actorId: IDS.hubMgr1, location: 'Dhaka Central Hub', createdAt: daysAgo(5) },
    { shipmentId: IDS.s9, status: 'OUT_FOR_DELIVERY', description: 'Out for delivery', actorId: IDS.ops, createdAt: daysAgo(3) },
    { shipmentId: IDS.s9, status: 'DELIVERY_FAILED', description: 'Delivery failed: No one home', actorId: IDS.courier2, createdAt: daysAgo(2) },
    // s10 — CANCELLED
    { shipmentId: IDS.s10, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer1, createdAt: daysAgo(15) },
    { shipmentId: IDS.s10, status: 'CANCELLED', description: 'Cancelled by customer', actorId: IDS.customer1, createdAt: daysAgo(5) },
    // s11 — RETURN_INITIATED
    { shipmentId: IDS.s11, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer5, createdAt: daysAgo(14) },
    { shipmentId: IDS.s11, status: 'PICKUP_REQUESTED', description: 'Pickup requested', actorId: IDS.customer5, createdAt: daysAgo(13) },
    { shipmentId: IDS.s11, status: 'ASSIGNED', description: 'Courier assigned', actorId: IDS.ops, createdAt: daysAgo(12) },
    { shipmentId: IDS.s11, status: 'PICKED_UP', description: 'Parcel picked up', actorId: IDS.courier1, createdAt: daysAgo(12) },
    { shipmentId: IDS.s11, status: 'AT_ORIGIN_HUB', description: 'Arrived at origin hub', actorId: IDS.hubMgr1, location: 'Dhaka Central Hub', createdAt: daysAgo(11) },
    { shipmentId: IDS.s11, status: 'IN_TRANSIT', description: 'In transit to Chattogram', actorId: IDS.hubMgr1, createdAt: daysAgo(9) },
    { shipmentId: IDS.s11, status: 'AT_DESTINATION_HUB', description: 'Arrived at Chattogram', actorId: IDS.hubMgr2, location: 'Chattogram Port Hub', createdAt: daysAgo(7) },
    { shipmentId: IDS.s11, status: 'OUT_FOR_DELIVERY', description: 'Out for delivery', actorId: IDS.ops, createdAt: daysAgo(5) },
    { shipmentId: IDS.s11, status: 'DELIVERY_FAILED', description: 'Delivery failed: Refused by recipient', actorId: IDS.courier3, createdAt: daysAgo(5) },
    { shipmentId: IDS.s11, status: 'DELIVERY_FAILED', description: 'Second attempt failed', actorId: IDS.courier3, createdAt: daysAgo(4) },
    { shipmentId: IDS.s11, status: 'RETURN_INITIATED', description: 'Return initiated: Max attempts reached', actorId: IDS.ops, createdAt: daysAgo(3) },
    // s12 & s13
    { shipmentId: IDS.s12, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer2, createdAt: daysAgo(2) },
    { shipmentId: IDS.s13, status: 'CREATED', description: 'Shipment booked', actorId: IDS.customer3, createdAt: daysAgo(1) },
  ];

  await prisma.shipmentTrackingEvent.createMany({
    data: trackingEventsData as never,
    skipDuplicates: false, // allow multiple events per shipment
  });

  // ── 9. Payments ────────────────────────────────────────────────────────────────
  console.log('💳  Seeding payments…');

  // NOTE: These are SIMULATED demo payments.
  // No real bKash or Stripe transactions were created.
  // bkashTransactionId values are fake demo IDs, never submitted to bKash.

  const paymentsData = [
    // s1 — pending, no payment initiated yet
    { shipmentId: IDS.s1, amount: 110.00, status: 'PENDING', provider: 'BKASH' },
    // s2 — completed bKash
    {
      shipmentId: IDS.s2, amount: 130.00, status: 'COMPLETED', provider: 'BKASH',
      bkashTransactionId: 'DEMO_TRX_001', bkashPaymentId: 'DEMO_BK_001', paidAt: daysAgo(3),
    },
    // s3 — completed bKash
    {
      shipmentId: IDS.s3, amount: 150.00, status: 'COMPLETED', provider: 'BKASH',
      bkashTransactionId: 'DEMO_TRX_002', bkashPaymentId: 'DEMO_BK_002', paidAt: daysAgo(4),
    },
    // s4 — completed Stripe (demo)
    {
      shipmentId: IDS.s4, amount: 200.00, status: 'COMPLETED', provider: 'STRIPE',
      stripePaymentIntent: 'pi_demo_0000001', stripeSessionId: 'cs_demo_0000001', paidAt: daysAgo(1),
    },
    // s5 — completed bKash
    {
      shipmentId: IDS.s5, amount: 125.00, status: 'COMPLETED', provider: 'BKASH',
      bkashTransactionId: 'DEMO_TRX_003', bkashPaymentId: 'DEMO_BK_003', paidAt: daysAgo(5),
    },
    // s6 — completed Stripe
    {
      shipmentId: IDS.s6, amount: 280.00, status: 'COMPLETED', provider: 'STRIPE',
      stripePaymentIntent: 'pi_demo_0000002', stripeSessionId: 'cs_demo_0000002', paidAt: daysAgo(6),
    },
    // s7 — completed bKash
    {
      shipmentId: IDS.s7, amount: 95.00, status: 'COMPLETED', provider: 'BKASH',
      bkashTransactionId: 'DEMO_TRX_004', bkashPaymentId: 'DEMO_BK_004', paidAt: daysAgo(7),
    },
    // s8 — completed bKash
    {
      shipmentId: IDS.s8, amount: 120.00, status: 'COMPLETED', provider: 'BKASH',
      bkashTransactionId: 'DEMO_TRX_005', bkashPaymentId: 'DEMO_BK_005', paidAt: daysAgo(9),
    },
    // s9 — completed bKash
    {
      shipmentId: IDS.s9, amount: 90.00, status: 'COMPLETED', provider: 'BKASH',
      bkashTransactionId: 'DEMO_TRX_006', bkashPaymentId: 'DEMO_BK_006', paidAt: daysAgo(11),
    },
    // s10 — cancelled (never paid)
    { shipmentId: IDS.s10, amount: 80.00, status: 'CANCELLED', provider: 'BKASH', cancelledAt: daysAgo(5) },
    // s11 — completed bKash
    {
      shipmentId: IDS.s11, amount: 150.00, status: 'COMPLETED', provider: 'BKASH',
      bkashTransactionId: 'DEMO_TRX_007', bkashPaymentId: 'DEMO_BK_007', paidAt: daysAgo(13),
    },
    // s12, s13 — pending
    { shipmentId: IDS.s12, amount: 130.00, status: 'PENDING', provider: 'BKASH' },
    { shipmentId: IDS.s13, amount: 140.00, status: 'PENDING', provider: 'BKASH' },
  ];

  for (const p of paymentsData) {
    // Use shipmentId uniqueness — only one payment per shipment in seed
    const exists = await prisma.payment.findFirst({ where: { shipmentId: p.shipmentId }, select: { id: true } });
    if (!exists) {
      await prisma.payment.create({
        data: {
          shipmentId: p.shipmentId,
          amount: p.amount,
          status: p.status as never,
          provider: p.provider as never,
          bkashTransactionId: (p as { bkashTransactionId?: string }).bkashTransactionId ?? null,
          bkashPaymentId: (p as { bkashPaymentId?: string }).bkashPaymentId ?? null,
          stripePaymentIntent: (p as { stripePaymentIntent?: string }).stripePaymentIntent ?? null,
          stripeSessionId: (p as { stripeSessionId?: string }).stripeSessionId ?? null,
          paidAt: (p as { paidAt?: Date }).paidAt ?? null,
          cancelledAt: (p as { cancelledAt?: Date }).cancelledAt ?? null,
        },
      });
    }
  }

  // ── 10. Pickup requests ───────────────────────────────────────────────────────
  console.log('🚚  Seeding pickup requests…');

  // Only for shipments that have requested or beyond
  const pickupData = [
    { shipmentId: IDS.s2, status: 'PENDING', requestedAt: daysAgo(3) },
    { shipmentId: IDS.s3, status: 'ASSIGNED', requestedAt: daysAgo(4) },
    { shipmentId: IDS.s4, status: 'COMPLETED', requestedAt: daysAgo(1), completedAt: hoursAgo(4) },
    { shipmentId: IDS.s5, status: 'COMPLETED', requestedAt: daysAgo(5), completedAt: daysAgo(4) },
    { shipmentId: IDS.s6, status: 'COMPLETED', requestedAt: daysAgo(6), completedAt: daysAgo(5) },
    { shipmentId: IDS.s7, status: 'COMPLETED', requestedAt: daysAgo(7), completedAt: daysAgo(6) },
    { shipmentId: IDS.s8, status: 'COMPLETED', requestedAt: daysAgo(9), completedAt: daysAgo(8) },
    { shipmentId: IDS.s9, status: 'COMPLETED', requestedAt: daysAgo(11), completedAt: daysAgo(10) },
    { shipmentId: IDS.s11, status: 'COMPLETED', requestedAt: daysAgo(13), completedAt: daysAgo(12) },
  ];

  for (const pr of pickupData) {
    const exists = await prisma.pickupRequest.findUnique({ where: { shipmentId: pr.shipmentId }, select: { id: true } });
    if (!exists) {
      await prisma.pickupRequest.create({ data: pr as never });
    }
  }

  // ── 11. Courier assignments ───────────────────────────────────────────────────
  console.log('🛵  Seeding courier assignments…');

  const assignmentsData = [
    // s3 — ACTIVE pickup assignment for courier1
    {
      shipmentId: IDS.s3, courierProfileId: IDS.cpCourier1, type: 'PICKUP', status: 'ACTIVE',
      assignedBy: IDS.ops, assignedAt: daysAgo(3), acceptedAt: daysAgo(3),
    },
    // s4 — COMPLETED pickup
    {
      shipmentId: IDS.s4, courierProfileId: IDS.cpCourier1, type: 'PICKUP', status: 'COMPLETED',
      assignedBy: IDS.ops, assignedAt: hoursAgo(8), acceptedAt: hoursAgo(7), pickedUpAt: hoursAgo(4),
    },
    // s5 — COMPLETED pickup by courier3
    {
      shipmentId: IDS.s5, courierProfileId: IDS.cpCourier3, type: 'PICKUP', status: 'COMPLETED',
      assignedBy: IDS.ops, assignedAt: daysAgo(4), acceptedAt: daysAgo(4), pickedUpAt: daysAgo(4),
    },
    // s6 — COMPLETED pickup by courier1
    {
      shipmentId: IDS.s6, courierProfileId: IDS.cpCourier1, type: 'PICKUP', status: 'COMPLETED',
      assignedBy: IDS.ops, assignedAt: daysAgo(5), acceptedAt: daysAgo(5), pickedUpAt: daysAgo(5),
    },
    // s6 — ACTIVE delivery assignment for courier4
    {
      shipmentId: IDS.s6, courierProfileId: IDS.cpCourier4, type: 'DELIVERY', status: 'ACTIVE',
      assignedBy: IDS.ops, assignedAt: daysAgo(1), acceptedAt: daysAgo(1),
    },
    // s7 — ACTIVE delivery by courier2
    {
      shipmentId: IDS.s7, courierProfileId: IDS.cpCourier2, type: 'DELIVERY', status: 'ACTIVE',
      assignedBy: IDS.ops, assignedAt: hoursAgo(2), acceptedAt: hoursAgo(2),
    },
    // s8 — COMPLETED delivery by courier4
    {
      shipmentId: IDS.s8, courierProfileId: IDS.cpCourier4, type: 'DELIVERY', status: 'COMPLETED',
      assignedBy: IDS.ops, assignedAt: daysAgo(2), acceptedAt: daysAgo(2), deliveredAt: daysAgo(1),
    },
    // s9 — COMPLETED (failed delivery) by courier2
    {
      shipmentId: IDS.s9, courierProfileId: IDS.cpCourier2, type: 'DELIVERY', status: 'COMPLETED',
      assignedBy: IDS.ops, assignedAt: daysAgo(3), acceptedAt: daysAgo(3),
    },
  ];

  for (const a of assignmentsData) {
    const exists = await prisma.courierAssignment.findFirst({
      where: { shipmentId: a.shipmentId, courierProfileId: a.courierProfileId, type: a.type as never },
      select: { id: true },
    });
    if (!exists) {
      await prisma.courierAssignment.create({ data: a as never });
    }
  }

  // ── 12. Hub transfer ──────────────────────────────────────────────────────────
  console.log('🏭  Seeding hub transfers…');

  const transfersData = [
    // s5: Cumilla → Dhaka (IN_TRANSIT)
    {
      shipmentId: IDS.s5, fromHubId: IDS.hubCumilla, toHubId: IDS.hubDhaka,
      status: 'IN_TRANSIT', dispatchedAt: daysAgo(2),
    },
    // s6: Dhaka → Chattogram (ARRIVED)
    {
      shipmentId: IDS.s6, fromHubId: IDS.hubDhaka, toHubId: IDS.hubCTG,
      status: 'ARRIVED', dispatchedAt: daysAgo(3), arrivedAt: daysAgo(1),
    },
    // s8: Chattogram → Cumilla (ARRIVED)
    {
      shipmentId: IDS.s8, fromHubId: IDS.hubCTG, toHubId: IDS.hubCumilla,
      status: 'ARRIVED', dispatchedAt: daysAgo(5), arrivedAt: daysAgo(3),
    },
  ];

  for (const t of transfersData) {
    const exists = await prisma.hubTransfer.findFirst({
      where: { shipmentId: t.shipmentId, fromHubId: t.fromHubId, toHubId: t.toHubId },
      select: { id: true },
    });
    if (!exists) {
      await prisma.hubTransfer.create({ data: t as never });
    }
  }

  // ── 13. Delivery attempts ──────────────────────────────────────────────────────
  console.log('📋  Seeding delivery attempts…');

  // s8 successful delivery
  const s8AttemptExists = await prisma.deliveryAttempt.findFirst({ where: { shipmentId: IDS.s8 } });
  if (!s8AttemptExists) {
    await prisma.deliveryAttempt.create({
      data: {
        shipmentId: IDS.s8, courierProfileId: IDS.cpCourier4,
        attemptNumber: 1, status: 'SUCCESS',
        notes: 'Delivered to recipient at door', deliveredAt: daysAgo(1),
        attemptedAt: daysAgo(1),
      },
    });
  }

  // s9 failed delivery
  const s9AttemptExists = await prisma.deliveryAttempt.findFirst({ where: { shipmentId: IDS.s9 } });
  if (!s9AttemptExists) {
    await prisma.deliveryAttempt.create({
      data: {
        shipmentId: IDS.s9, courierProfileId: IDS.cpCourier2,
        attemptNumber: 1, status: 'FAILED',
        failureReason: 'NO_ONE_HOME', notes: 'Nobody answered the door',
        attemptedAt: daysAgo(2),
      },
    });
  }

  // s11 two failed attempts
  const s11AttemptCount = await prisma.deliveryAttempt.count({ where: { shipmentId: IDS.s11 } });
  if (s11AttemptCount === 0) {
    await prisma.deliveryAttempt.createMany({
      data: [
        {
          shipmentId: IDS.s11, courierProfileId: IDS.cpCourier3,
          attemptNumber: 1, status: 'FAILED',
          failureReason: 'REFUSED_BY_RECIPIENT', notes: 'Recipient refused to accept',
          attemptedAt: daysAgo(5),
        },
        {
          shipmentId: IDS.s11, courierProfileId: IDS.cpCourier3,
          attemptNumber: 2, status: 'FAILED',
          failureReason: 'REFUSED_BY_RECIPIENT', notes: 'Second refusal — return initiated',
          attemptedAt: daysAgo(4),
        },
      ],
    });
  }

  // ── 14. Notifications ──────────────────────────────────────────────────────────
  console.log('🔔  Seeding notifications…');

  const notificationsData = [
    { userId: IDS.customer1, type: 'SHIPMENT_CREATED', title: 'Shipment Booked', message: 'Your shipment LF-20260901-DEMO0001 has been booked. Amount due: BDT 110.00', metadata: { shipmentId: IDS.s1, trackingNumber: 'LF-20260901-DEMO0001' }, isRead: false },
    { userId: IDS.customer2, type: 'SHIPMENT_CREATED', title: 'Shipment Booked', message: 'Your shipment LF-20260901-DEMO0002 has been booked. Amount due: BDT 130.00', metadata: { shipmentId: IDS.s2 }, isRead: false },
    { userId: IDS.customer2, type: 'PAYMENT_COMPLETED', title: 'Payment Confirmed', message: 'Payment confirmed for shipment LF-20260901-DEMO0002. TrxID: DEMO_TRX_001', metadata: { shipmentId: IDS.s2 }, isRead: true },
    { userId: IDS.customer3, type: 'COURIER_ASSIGNED', title: 'Courier Assigned', message: 'A courier has been assigned to your shipment LF-20260901-DEMO0003', metadata: { shipmentId: IDS.s3 }, isRead: false },
    { userId: IDS.customer3, type: 'DELIVERED', title: 'Parcel Delivered', message: 'Your shipment LF-20260901-DEMO0008 has been delivered', metadata: { shipmentId: IDS.s8 }, isRead: false },
    { userId: IDS.customer4, type: 'DELIVERY_FAILED', title: 'Delivery Attempt Failed', message: 'Delivery attempt for LF-20260901-DEMO0009 failed: No one home', metadata: { shipmentId: IDS.s9 }, isRead: false },
    { userId: IDS.courier1, type: 'COURIER_ASSIGNED', title: 'New Assignment', message: 'You have been assigned to shipment LF-20260901-DEMO0003', metadata: { shipmentId: IDS.s3 }, isRead: false },
    { userId: IDS.admin, type: 'GENERAL', title: 'Demo Environment Ready', message: 'The LogiFlow demo environment has been seeded and is ready for testing.', metadata: {}, isRead: false },
  ];

  await prisma.notification.createMany({
    data: notificationsData as never,
    skipDuplicates: false, // notifications are not unique
  });

  // ── 15. Audit logs ─────────────────────────────────────────────────────────────
  console.log('📝  Seeding audit logs…');

  const auditLogsData = [
    { actorId: IDS.admin, action: 'HUB_CREATED', resourceType: 'Hub', resourceId: IDS.hubDhaka, after: { name: 'Dhaka Central Hub' }, createdAt: daysAgo(60) },
    { actorId: IDS.admin, action: 'HUB_CREATED', resourceType: 'Hub', resourceId: IDS.hubCumilla, after: { name: 'Cumilla Regional Hub' }, createdAt: daysAgo(55) },
    { actorId: IDS.admin, action: 'HUB_CREATED', resourceType: 'Hub', resourceId: IDS.hubCTG, after: { name: 'Chattogram Port Hub' }, createdAt: daysAgo(50) },
    { actorId: IDS.customer1, action: 'SHIPMENT_CREATED', resourceType: 'Shipment', resourceId: IDS.s1, after: { trackingNumber: 'LF-20260901-DEMO0001' }, createdAt: daysAgo(3) },
    { actorId: IDS.customer2, action: 'PAYMENT_INITIATED', resourceType: 'Payment', resourceId: IDS.s2, metadata: { provider: 'BKASH' }, createdAt: daysAgo(3) },
    { actorId: null, action: 'PAYMENT_COMPLETED', resourceType: 'Payment', resourceId: IDS.s2, after: { trxID: 'DEMO_TRX_001' }, createdAt: daysAgo(3) },
    { actorId: IDS.ops, action: 'COURIER_ASSIGNED', resourceType: 'CourierAssignment', resourceId: IDS.s3, createdAt: daysAgo(3) },
    { actorId: IDS.courier4, action: 'DELIVERY_CONFIRMED', resourceType: 'Shipment', resourceId: IDS.s8, createdAt: daysAgo(1) },
  ];

  await prisma.auditLog.createMany({
    data: auditLogsData as never,
    skipDuplicates: false,
  });

  // ── Done ───────────────────────────────────────────────────────────────────────

  console.log('\n✅  Demo seed complete!\n');
  console.log('━'.repeat(60));
  console.log('  DEMO ACCOUNTS  (all use the same password)');
  console.log('━'.repeat(60));
  console.log('  Role               Email                              Password');
  console.log('  ─────────────────  ─────────────────────────────────  ──────────────────');
  console.log(`  ADMIN              admin@demo.logiflow.app            ${DEMO_PASSWORD}`);
  console.log(`  OPERATIONS_MANAGER ops@demo.logiflow.app              ${DEMO_PASSWORD}`);
  console.log(`  HUB_MANAGER        hub.dhaka@demo.logiflow.app        ${DEMO_PASSWORD}`);
  console.log(`  HUB_MANAGER        hub.ctg@demo.logiflow.app          ${DEMO_PASSWORD}`);
  console.log(`  COURIER            courier1@demo.logiflow.app         ${DEMO_PASSWORD}`);
  console.log(`  COURIER            courier2@demo.logiflow.app         ${DEMO_PASSWORD}`);
  console.log(`  CUSTOMER           customer1@demo.logiflow.app        ${DEMO_PASSWORD}`);
  console.log(`  CUSTOMER           customer2@demo.logiflow.app        ${DEMO_PASSWORD}`);
  console.log('━'.repeat(60));
  console.log('\n  DEMO TRACKING NUMBERS (for public tracking):');
  console.log('  LF-20260901-DEMO0001  (CREATED — awaiting payment)');
  console.log('  LF-20260901-DEMO0005  (IN_TRANSIT)');
  console.log('  LF-20260901-DEMO0008  (DELIVERED)');
  console.log('  LF-20260901-DEMO0009  (DELIVERY_FAILED)');
  console.log('━'.repeat(60));
}

main()
  .catch((err) => {
    console.error('❌  Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
