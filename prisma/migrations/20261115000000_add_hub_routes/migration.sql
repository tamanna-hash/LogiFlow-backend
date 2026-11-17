-- Migration: add_hub_routes
-- Adds the HubRoute table for the Day-4 hub-to-hub route optimization system.
--
-- Safety: purely additive — no existing tables, columns, or indexes are modified.
-- Existing data: unaffected. No backfill required.

-- ── New table ─────────────────────────────────────────────────────────────────

CREATE TABLE "hub_routes" (
  "id"        TEXT NOT NULL,
  "fromHubId" TEXT NOT NULL,
  "toHubId"   TEXT NOT NULL,
  "cost"      DOUBLE PRECISION NOT NULL DEFAULT 1,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hub_routes_pkey" PRIMARY KEY ("id")
);

-- ── Foreign keys ───────────────────────────────────────────────────────────────

ALTER TABLE "hub_routes"
  ADD CONSTRAINT "hub_routes_fromHubId_fkey"
  FOREIGN KEY ("fromHubId") REFERENCES "hubs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hub_routes"
  ADD CONSTRAINT "hub_routes_toHubId_fkey"
  FOREIGN KEY ("toHubId") REFERENCES "hubs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Unique constraint: one directed route per (from, to) pair ──────────────────

CREATE UNIQUE INDEX "hub_routes_fromHubId_toHubId_key"
  ON "hub_routes"("fromHubId", "toHubId");

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX "hub_routes_fromHubId_idx"
  ON "hub_routes"("fromHubId");

CREATE INDEX "hub_routes_toHubId_idx"
  ON "hub_routes"("toHubId");

CREATE INDEX "hub_routes_isActive_idx"
  ON "hub_routes"("isActive");
