import { env } from './app/config/env';
import { connectDatabase, disconnectDatabase } from './app/lib/prisma';
import app from './app';

const PORT = env.PORT;

// ── Start server ──────────────────────────────────────────────────────────────

connectDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`LogiFlow Backend running on port ${PORT}`);
    console.log(`Environment : ${env.NODE_ENV}`);
    console.log(`API Base    : http://localhost:${PORT}/api/v1`);
  });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

const shutdown = async (signal: string): Promise<void> => {
  console.log(`\n[Server] ${signal} received — shutting down gracefully...`);
  await disconnectDatabase();
  console.log('[Server] Shutdown complete.');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Unhandled errors ──────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
  shutdown('uncaughtException');
});
