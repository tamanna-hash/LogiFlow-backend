-- Migration: add_shipment_risk_assessment
-- Adds the ShipmentRiskAssessment table and supporting enums for the
-- Day 1 Intelligent Shipment Risk Engine.
--
-- Safety: purely additive — no existing tables, columns, or indexes are modified.
-- Existing data: unaffected. No backfill required.

-- ── New enum types ────────────────────────────────────────────────────────────

CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TYPE "RiskAssessmentStatus" AS ENUM ('ASSESSED', 'INSUFFICIENT_DATA');

CREATE TYPE "RiskFactorCode" AS ENUM (
  'STATUS_INACTIVE_WARNING',
  'STATUS_INACTIVE_CRITICAL',
  'FAILED_DELIVERY_ATTEMPT_1',
  'FAILED_DELIVERY_ATTEMPT_2',
  'FAILED_DELIVERY_ATTEMPT_MAX',
  'COURIER_NOT_ACCEPTED',
  'MULTIPLE_HUB_TRANSFERS'
);

-- ── New AuditAction value ─────────────────────────────────────────────────────
-- PostgreSQL requires ALTER TYPE to add enum values.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RISK_ASSESSMENT_CREATED';

-- ── New table ─────────────────────────────────────────────────────────────────

CREATE TABLE "shipment_risk_assessments" (
  "id"               TEXT NOT NULL,
  "shipmentId"       TEXT NOT NULL,
  "riskScore"        INTEGER NOT NULL,
  "riskLevel"        "RiskLevel" NOT NULL,
  "assessmentStatus" "RiskAssessmentStatus" NOT NULL DEFAULT 'ASSESSED',
  "factors"          JSONB NOT NULL DEFAULT '[]',
  "shipmentStatus"   "ShipmentStatus" NOT NULL,
  "lastEventAt"      TIMESTAMP(3),
  "assessedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shipment_risk_assessments_pkey" PRIMARY KEY ("id")
);

-- ── Foreign key ───────────────────────────────────────────────────────────────

ALTER TABLE "shipment_risk_assessments"
  ADD CONSTRAINT "shipment_risk_assessments_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Lookup all assessments for a shipment
CREATE INDEX "shipment_risk_assessments_shipmentId_idx"
  ON "shipment_risk_assessments"("shipmentId");

-- Latest assessment per shipment (most common query pattern)
CREATE INDEX "shipment_risk_assessments_shipmentId_assessedAt_idx"
  ON "shipment_risk_assessments"("shipmentId", "assessedAt" DESC);

-- Operational dashboard: filter by risk level across all shipments
CREATE INDEX "shipment_risk_assessments_riskLevel_idx"
  ON "shipment_risk_assessments"("riskLevel");

-- Global timeline of assessments (admin/analytics queries)
CREATE INDEX "shipment_risk_assessments_assessedAt_idx"
  ON "shipment_risk_assessments"("assessedAt" DESC);
