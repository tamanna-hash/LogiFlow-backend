import type { Role } from '../../../generated/prisma';
import { prisma } from '../../lib/prisma';
import { uploadToCloudinary } from '../../lib/cloudinary';
import { NotFoundError, BadRequestError } from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { safeUserSelect } from '../../types';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import { notDeleted } from '../../utils/notDeleted';
import type { UpdateProfileInput, UpdateRoleInput } from './user.schema';
import type { PrismaTx } from '../../types/prisma';

const userWithProfileSelect = {
  ...safeUserSelect,
  // hasPassword is derived from this — the raw hash is stripped before the response leaves the service
  passwordHash: true,
  customerProfile: { select: { defaultAddress: true, city: true, postalCode: true } },
  courierProfile: { select: { hubId: true, vehicleType: true, vehicleNumber: true, licenseNumber: true, availability: true, totalDeliveries: true } },
  hubManagerProfile: { select: { hubId: true, hub: { select: { name: true, code: true } } } },
};

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId, ...notDeleted() },
    select: userWithProfileSelect,
  });
  if (!user) throw new NotFoundError('User not found.');

  // Validate role-specific profile exists and throw helpful error if missing
  if (user.role === 'HUB_MANAGER' && !user.hubManagerProfile) {
    throw new BadRequestError('No hub is assigned to this account. Contact an administrator.');
  }
  if (user.role === 'COURIER' && !user.courierProfile) {
    throw new BadRequestError('Courier profile is not set up. Contact an administrator.');
  }
  // CUSTOMER, OPERATIONS, and ADMIN don't require specific profiles to function
  // (CUSTOMER profile is created automatically, OPERATIONS and ADMIN have no profile tables)

  // Derive hasPassword from the hash — never expose the raw hash to the frontend
  const { passwordHash, ...safeUser } = user;
  return { ...safeUser, hasPassword: passwordHash !== null };
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
  avatarBuffer?: Buffer,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId, ...notDeleted() },
    select: { id: true, role: true, avatarUrl: true },
  });
  if (!user) throw new NotFoundError('User not found.');

  let avatarUrl: string | undefined;
  if (avatarBuffer) {
    avatarUrl = await uploadToCloudinary(avatarBuffer, 'avatars', userId);
  }

  const { firstName, lastName, phone, defaultAddress, city, postalCode, vehicleType, vehicleNumber, licenseNumber } = input;

  return prisma.$transaction(async (tx: PrismaTx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(phone && { phone }),
        ...(avatarUrl && { avatarUrl }),
      },
      select: userWithProfileSelect,
    });

    // Update role-specific profile
    if (user.role === 'CUSTOMER' && (defaultAddress || city || postalCode)) {
      await tx.customerProfile.upsert({
        where: { userId },
        update: { ...(defaultAddress && { defaultAddress }), ...(city && { city }), ...(postalCode && { postalCode }) },
        create: { userId, defaultAddress, city, postalCode },
      });
    }

    if (user.role === 'COURIER' && (vehicleType || vehicleNumber || licenseNumber)) {
      await tx.courierProfile.update({
        where: { userId },
        data: {
          ...(vehicleType && { vehicleType }),
          ...(vehicleNumber && { vehicleNumber }),
          ...(licenseNumber && { licenseNumber }),
        },
      });
    }

    return updated;
  });
}

export async function listUsers(params: {
  page: number; limit: number; role?: Role; isActive?: boolean;
  search?: string; sortBy: string; sortOrder: string; includeDeleted?: boolean;
}) {
  const { page, limit, role, isActive, search, sortBy, sortOrder, includeDeleted } = params;

  const where = {
    ...(!includeDeleted && notDeleted()),
    ...(role && { role }),
    ...(isActive !== undefined && { isActive }),
    ...(search && {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' as const } },
        { lastName: { contains: search, mode: 'insensitive' as const } },
        { email: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      ...getPrismaSkipTake(page, limit),
      select: safeUserSelect,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, meta: buildPaginationMeta(total, page, limit) };
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: userWithProfileSelect,
  });
  if (!user) throw new NotFoundError('User not found.');
  return user;
}

export async function updateUserRole(
  targetId: string,
  input: UpdateRoleInput,
  actorId: string,
) {
  const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, deletedAt: true } });
  if (!user || user.deletedAt) throw new NotFoundError('User not found.');

  // Prevent demoting last admin
  if (user.role === 'ADMIN' && input.role !== 'ADMIN') {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN', deletedAt: null } });
    if (adminCount <= 1) throw new BadRequestError('Cannot demote the last admin account.');
  }

  const before = { role: user.role };
  
  // Update role and create corresponding profile if needed
  const updated = await prisma.$transaction(async (tx: PrismaTx) => {
    const updatedUser = await tx.user.update({
      where: { id: targetId },
      data: { role: input.role },
      select: safeUserSelect,
    });

    // Create role-specific profile if it doesn't exist
    if (input.role === 'CUSTOMER') {
      await tx.customerProfile.upsert({
        where: { userId: targetId },
        update: {},
        create: { userId: targetId },
      });
    } else if (input.role === 'COURIER') {
      await tx.courierProfile.upsert({
        where: { userId: targetId },
        update: {},
        create: { userId: targetId },
      });
    } else if (input.role === 'HUB_MANAGER') {
      await tx.hubManagerProfile.upsert({
        where: { userId: targetId },
        update: {},
        create: { userId: targetId },
      });
    }
    // OPERATIONS and ADMIN roles don't have profile tables

    return updatedUser;
  });

  await createAuditLog({
    actorId,
    action: 'USER_ROLE_CHANGED',
    resourceType: 'User',
    resourceId: targetId,
    before,
    after: { role: input.role },
  });

  return updated;
}

export async function softDeleteUser(targetId: string, actorId: string) {
  const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, deletedAt: true } });
  if (!user || user.deletedAt) throw new NotFoundError('User not found.');

  if (user.role === 'ADMIN') {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN', deletedAt: null } });
    if (adminCount <= 1) throw new BadRequestError('Cannot delete the last admin account.');
  }

  // Check for active shipments
  const activeShipments = await prisma.shipment.count({
    where: {
      customerId: targetId,
      deletedAt: null,
      status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] },
    },
  });
  if (activeShipments > 0) {
    throw new BadRequestError(`User has ${activeShipments} active shipment(s). Resolve them before deleting.`);
  }

  await prisma.user.update({ where: { id: targetId }, data: { deletedAt: new Date(), isActive: false } });

  await createAuditLog({ actorId, action: 'USER_DELETED', resourceType: 'User', resourceId: targetId });
}
