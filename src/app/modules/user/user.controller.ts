import type { Request, Response } from 'express';
import * as userService from './user.service';
import { sendSuccess } from '../../utils/response';
import { userListQuerySchema } from './user.schema';

export async function getMe(req: Request, res: Response): Promise<void> {
  const user = await userService.getMe(req.user!.id);
  sendSuccess(res, user, 'Profile fetched');
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const avatarBuffer = req.file?.buffer;
  const updated = await userService.updateProfile(req.user!.id, req.body, avatarBuffer);
  sendSuccess(res, updated, 'Profile updated');
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const params = userListQuerySchema.parse(req.query);
  const { users, meta } = await userService.listUsers(params);
  sendSuccess(res, users, 'Users fetched', 200, meta);
}

export async function getUserById(req: Request, res: Response): Promise<void> {
  const user = await userService.getUserById(req.params.id);
  sendSuccess(res, user, 'User fetched');
}

export async function updateUserRole(req: Request, res: Response): Promise<void> {
  const updated = await userService.updateUserRole(req.params.id, req.body, req.user!.id);
  sendSuccess(res, updated, 'User role updated');
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  await userService.softDeleteUser(req.params.id, req.user!.id);
  sendSuccess(res, null, 'User deactivated successfully');
}
