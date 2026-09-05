import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from '../config/env';
import { prisma } from './prisma';
import { ConflictError } from '../errors';

export interface GoogleProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
}

/**
 * Initialises the Google OAuth 2.0 Passport strategy.
 * Called once during app startup.
 *
 * Flow:
 *  - If googleId already exists → return existing user (login)
 *  - If email exists but no googleId → throw conflict (user registered with password)
 *  - Otherwise → create new CUSTOMER account
 */
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
            return done(new Error('No email returned from Google'), undefined);
          }

          const googleId = profile.id;
          const firstName = profile.name?.givenName ?? profile.displayName?.split(' ')[0] ?? 'User';
          const lastName = profile.name?.familyName ?? profile.displayName?.split(' ').slice(1).join(' ') ?? '';
          const avatarUrl = profile.photos?.[0]?.value;

          // Check for existing user by googleId
          const existingByGoogle = await prisma.user.findUnique({
            where: { googleId },
            select: { id: true, email: true, firstName: true, lastName: true, role: true, deletedAt: true, isActive: true },
          });

          if (existingByGoogle) {
            if (existingByGoogle.deletedAt) {
              return done(new Error('This account has been deactivated.'), undefined);
            }
            return done(null, existingByGoogle);
          }

          // Check for existing user by email (registered with password)
          const existingByEmail = await prisma.user.findUnique({
            where: { email },
            select: { id: true, googleId: true },
          });

          if (existingByEmail && !existingByEmail.googleId) {
            return done(
              new ConflictError(
                'An account with this email already exists. Please log in with your email and password.',
              ),
              undefined,
            );
          }

          // Create new CUSTOMER account
          const newUser = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
              data: {
                email,
                googleId,
                firstName,
                lastName,
                avatarUrl,
                role: 'CUSTOMER',
                isEmailVerified: true, // Google verifies email
              },
              select: { id: true, email: true, firstName: true, lastName: true, role: true },
            });

            await tx.customerProfile.create({ data: { userId: user.id } });

            return user;
          });

          return done(null, newUser);
        } catch (err) {
          return done(err as Error, undefined);
        }
      },
    ),
  );

  // Minimal serialisation — we use JWT, not session-based auth
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user as Express.User));
}
