import type { Role } from '../../generated/prisma';

declare global {
  namespace Express {
    interface User {
      id: string;
      role: Role;
      email: string;
      firstName: string;
      lastName: string;
      hubId?: string | null; // populated for HUB_MANAGER from DB — never from JWT
    }

    interface Request {
      user?: User;
    }
  }
}

export {};
