import { prisma } from './src/app/lib/prisma.js';
const users = await prisma.user.findMany({
  select: { id: true, email: true, role: true, isActive: true, deletedAt: true },
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' },
  take: 10
});
console.log(JSON.stringify(users, null, 2));
process.exit(0);
