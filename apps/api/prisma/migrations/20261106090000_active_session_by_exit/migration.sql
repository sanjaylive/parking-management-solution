-- A session "occupies" a vehicle/plate until the vehicle has physically exited.
-- EXCEPTION sessions from unpaid offline exits have exitAt set and must not block re-entry.
DROP INDEX IF EXISTS "ParkingSession_one_active_per_plate";
CREATE UNIQUE INDEX "ParkingSession_one_active_per_plate"
  ON "ParkingSession" ("facilityId", "plateNormalized")
  WHERE "exitAt" IS NULL AND "status" NOT IN ('COMPLETED', 'CANCELLED');
