-- Forward-only Kalman estimate per processed point (before the RTS backward pass),
-- so the dashboard can compare Kalman vs RTS. Nullable: rows from older runs stay valid.
ALTER TABLE "trip_processed_points" ADD COLUMN "kf_lat" DOUBLE PRECISION,
ADD COLUMN "kf_lon" DOUBLE PRECISION,
ADD COLUMN "kf_sigma_m" DOUBLE PRECISION;
