-- AlterTable: Make hubId nullable in hub_manager_profiles
ALTER TABLE "hub_manager_profiles" ALTER COLUMN "hubId" DROP NOT NULL;

-- DropIndex: Remove unique constraint from hubId (a hub can have multiple managers if needed)
DROP INDEX IF EXISTS "hub_manager_profiles_hubId_key";
