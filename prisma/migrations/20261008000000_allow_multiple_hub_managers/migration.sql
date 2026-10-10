-- Allow multiple Hub Managers per Hub
-- Previously hubId had a @unique constraint (one manager per hub).
-- Dropping it to allow many-to-one: multiple HubManagerProfiles can reference the same Hub.

-- Drop the unique constraint on hubId
ALTER TABLE "hub_manager_profiles" DROP CONSTRAINT IF EXISTS "hub_manager_profiles_hubId_key";

-- Add a regular index for efficient lookup by hubId
CREATE INDEX IF NOT EXISTS "hub_manager_profiles_hubId_idx" ON "hub_manager_profiles"("hubId");
