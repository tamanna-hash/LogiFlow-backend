import { env } from './app/config/env';
import { connectDatabase, disconnectDatabase } from './app/lib/prisma';
import app from './app';

const PORT = env.PORT;

async function bootstrap(): Promise<void> {
  // Connect to database before starting the server
  await connectDatabase();

  const server = app.listen(PORT, () => {
    console.log(`

       LogiFlow Backend API                     
  Environment : ${env.NODE_ENV.padEnd(32)}║
  Port        : ${String(PORT).padEnd(32)}║
  API Base    : http://localhost:${PORT}/api/v1${' '.repeat(Math.max(0, 15 - String(PORT).length))}║

    `);
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[Server] ${signal} received — shutting down gracefully...`);
    server.close(async () => {
      await disconnectDatabase();
      console.log('[Server] Shutdown complete.');
      process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown hangs
    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // ── Unhandled errors ─────────────────────────────────────────────────────────
  process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled promise rejection:', reason);
    // Do not exit — log and continue for operational stability
  });

  process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught exception:', err);
    shutdown('uncaughtException');
  });
}

bootstrap().catch((err) => {
  console.error('[Server] Bootstrap failed:', err);
  process.exit(1);
});
