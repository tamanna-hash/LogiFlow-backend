-- LogiFlow Initial Migration
-- Note: The main schema is managed by Prisma migrate.
-- This file adds the partial unique index that Prisma cannot express in schema syntax.

-- Partial unique index: only one ACTIVE assignment per shipment at any time.
-- This is the DB-level concurrency guard for courier assignment.
CREATE UNIQUE INDEX IF NOT EXISTS "courier_assignment_active_unique"
ON "courier_assignments"("shipmentId")
WHERE "status" = 'ACTIVE';

-- Index on tokenPrefix for efficient refresh token lookup (replaces full table scan)
CREATE INDEX IF NOT EXISTS "refresh_tokens_token_prefix_idx"
ON "refresh_tokens"("tokenPrefix");
