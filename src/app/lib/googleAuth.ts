/**
 * googleAuth.ts — Passport Google OAuth 2.0 strategy.
 *
 * Account linking policy:
 *  Google verifies email ownership server-side through the OAuth exchange.
 *  When Google returns a verified email that matches an existing LogiFlow
 *  password account we auto-link the Google identity to that account and
 *  issue a session for it. This is safe because:
 *    1. Google has already proven the user owns that email address.
 *    2. The linking writes the stable Google subject (googleId) — a unique
 *       identifier that cannot be guessed or spoofed.
 *    3. The user's password, role, ID, and all data are preserved.
 *    4. If the Google subject is already linked to a DIFFERENT account that
 *       would be a data-integrity violation — we reject it.
 *
 * Four branches:
 *  A. googleId already linked to a LogiFlow account → login (return user)
 *  B. email exists, no googleId yet                 → auto-link, then login
 *  C. email exists, googleId linked to someone else → reject (integrity error)
 *  D. no existing user at all                       → create new CUSTOMER
 */

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from '../config/env';
import { prisma } from './prisma';
import { ConflictError } from '../errors';
import { createAuditLog } from '../modules/audit/audit.service';
import type { PrismaTx } from '../types/prisma';

export interface GoogleProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
}

export function initGoogleStrategy(): void {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: env.GOOGLE_CALLBACK_URL,
        scope: ['email', 'profile'],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('No email returned from Google. Please ensure your Google account has a verified email address.'), undefined);
          }
          if (profile._json.email_verified !== true) {
            return done(new Error('Google email must be verified.'), undefined);
          }

          const googleId = profile.id;
          const firstName = profile.name?.givenName ?? profile.displayName?.split(' ')[0] ?? 'User';
          const lastName  = profile.name?.familyName ?? profile.displayName?.split(' ').slice(1).join(' ') ?? '';
          const avatarUrl = profile.photos?.[0]?.value;

          // ── Branch A: Google identity already linked to a LogiFlow account ─────
          const existingByGoogleId = await prisma.user.findUnique({
            where: { googleId },
            select: {
              id: true, email: true, firstName: true, lastName: true,
              role: true, deletedAt: true, isActive: true,
            },
          });

          if (existingByGoogleId) {
            if (existingByGoogleId.deletedAt) {
              return done(new Error('This account has been deactivated. Please contact support.'), undefined);
            }
            if (!existingByGoogleId.isActive) {
              return done(new Error('This account has been suspended. Please contact support.'), undefined);
            }
            // Existing Google user — normal login, no changes needed
            return done(null, existingByGoogleId);
          }

          // ── Branch B / C: Look up by email ────────────────────────────────────
          const existingByEmail = await prisma.user.findUnique({
            where: { email },
            select: {
              id: true, email: true, firstName: true, lastName: true,
              role: true, googleId: true, deletedAt: true, isActive: true, avatarUrl: true,
            },
          });

          if (existingByEmail) {
            // Branch C: email account exists but is already linked to a DIFFERENT Google identity
            // This would mean two Google accounts sharing one LogiFlow account — reject.
            if (existingByEmail.googleId && existingByEmail.googleId !== googleId) {
              return done(
                new ConflictError(
                  'This account is already linked to a different Google identity. Please contact support.',
                ),
                undefined,
              );
            }

            // Guard: account deactivated or suspended
            if (existingByEmail.deletedAt) {
              return done(new Error('This account has been deactivated. Please contact support.'), undefined);
            }
            if (!existingByEmail.isActive) {
              return done(new Error('This account has been suspended. Please contact support.'), undefined);
            }

            // Branch B: email/password account exists with no Google link yet.
            // Auto-link: Google has proven ownership of this email address.
            // We write the googleId and (optionally) avatarUrl, preserving everything else.
            const linked = await prisma.user.update({
              where: { id: existingByEmail.id },
              data: {
                googleId,
                // Only backfill avatarUrl if the user has none — never overwrite
                ...(avatarUrl && !existingByEmail.avatarUrl ? { avatarUrl } : {}),
              },
              select: {
                id: true, email: true, firstName: true, lastName: true, role: true,
              },
            });

            await createAuditLog({
              actorId: existingByEmail.id,
              action: 'GOOGLE_ACCOUNT_LINKED',
              resourceType: 'User',
              resourceId: existingByEmail.id,
              after: { googleId, method: 'auto_link_verified_email' },
            });

            return done(null, linked);
          }

          // ── Branch D: New user — create account + customerProfile ─────────────
          const newUser = await prisma.$transaction(async (tx: PrismaTx) => {
            const user = await tx.user.create({
              data: {
                email,
                googleId,
                firstName,
                lastName,
                avatarUrl,
                role:             'CUSTOMER',  // hardcoded — never from Google profile
                isEmailVerified:  true,         // Google has verified the email
                isActive:         true,
                // passwordHash intentionally omitted (null) — Google-only account
              },
              select: { id: true, email: true, firstName: true, lastName: true, role: true },
            });

            await tx.customerProfile.create({ data: { userId: user.id } });

            return user;
          });

          await createAuditLog({
            actorId: newUser.id,
            action: 'USER_REGISTERED',
            resourceType: 'User',
            resourceId: newUser.id,
            after: { email: newUser.email, role: newUser.role, provider: 'GOOGLE' },
          });

          return done(null, newUser);
        } catch (err) {
          return done(err as Error, undefined);
        }
      },
    ),
  );

  // Minimal serialisation — stateless JWT flow, no session store needed
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user as Express.User));
}
