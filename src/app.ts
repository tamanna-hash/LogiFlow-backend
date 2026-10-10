import 'express-async-errors';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import passport from 'passport';
import { env } from './app/config/env';
import { globalErrorHandler } from './app/middleware/globalErrorHandler';
import { notFound } from './app/middleware/notFound';
import { demoGuard } from './app/middleware/demoGuard';
import { initGoogleStrategy } from './app/lib/googleAuth';
import { rateLimiter } from './app/lib/rateLimiter';
import apiRouter from './app/routes/index';

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());
app.disable('x-powered-by');

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow both localhost and production frontend URLs
      const allowed = [
        'http://localhost:3000',           // Local development
        'https://logiflow-hash.vercel.app', // Production frontend
        env.FRONTEND_URL,                   // From .env (fallback)
      ];
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// ── Body parsers ──────────────────────────────────────────────────────────────
// Skip JSON parsing for Stripe webhook — it needs the raw Buffer for sig verification
app.use((req, res, next) => {
  if (req.path === '/api/v1/payments/stripe/webhook') {
    next(); // express.raw() is applied in the route itself
  } else {
    express.json({ limit: '10mb' })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Passport (for Google OAuth) ───────────────────────────────────────────────
initGoogleStrategy();
app.use(passport.initialize());

// ── Request logger (development only) ─────────────────────────────────────────
if (env.NODE_ENV === 'development') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
  });
}

// ── General rate limit on all API routes ─────────────────────────────────────
app.use('/api/v1', rateLimiter('unauthenticated'));

// ── Demo read-only guard ──────────────────────────────────────────────────────
// Must run after body parsers but before route handlers.
// Blocks all mutating requests for @demo.logiflow.app accounts.
app.use('/api/v1', demoGuard);

// ── Health check (no rate limit, no auth) ────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'LogiFlow API is running',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
  });
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/v1', apiRouter);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use(notFound);

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(globalErrorHandler);

export default app;
