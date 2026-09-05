import 'express-async-errors';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import passport from 'passport';
import { env } from './app/config/env';
import { globalErrorHandler } from './app/middleware/globalErrorHandler';
import { notFound } from './app/middleware/notFound';
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
      const allowed = [env.FRONTEND_URL];
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
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
