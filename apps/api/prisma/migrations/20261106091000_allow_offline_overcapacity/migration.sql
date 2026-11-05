-- Provisional entries synced from offline gates represent vehicles physically inside, so the counter
-- must be able to exceed capacity to stay truthful. Live entries remain capped by OccupancyService,
-- which locks the pool row (SELECT ... FOR UPDATE) and refuses entry when full.
ALTER TABLE "ParkingCapacityPool" DROP CONSTRAINT IF EXISTS "pool_within_capacity";
