-- CreateTable
CREATE TABLE "device_keys" (
    "id" SERIAL NOT NULL,
    "device_id" TEXT NOT NULL,
    "driver" TEXT,
    "vehicle" TEXT,
    "route" TEXT,
    "device_name" TEXT,
    "assignment" TEXT,
    "capture_interval_seconds" INTEGER,
    "upload_interval_seconds" INTEGER,
    "max_records_per_request" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" SERIAL NOT NULL,
    "trip_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'In Transit',
    "started_at" TIMESTAMP(3),
    "stopped_at" TIMESTAMP(3),
    "driver" TEXT,
    "vehicle" TEXT,
    "route" TEXT,
    "assignment" TEXT,
    "odometer_start_km" DOUBLE PRECISION,
    "odometer_end_km" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coordinates" (
    "id" SERIAL NOT NULL,
    "trip_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "has_gps" BOOLEAN NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "speed_kph" DOUBLE PRECISION,
    "speed_mps" DOUBLE PRECISION,
    "speed_accuracy_mps" DOUBLE PRECISION,
    "heading_degrees" DOUBLE PRECISION,
    "accuracy_meters" DOUBLE PRECISION,
    "altitude_meters" DOUBLE PRECISION,
    "battery_percent" DOUBLE PRECISION,
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "device_time" TIMESTAMP(3) NOT NULL,
    "capture_source" TEXT,
    "app_state" TEXT,
    "network_type" TEXT,
    "internet_available" BOOLEAN,
    "location_service_on" BOOLEAN,
    "location_permission" TEXT,
    "was_forwarded" BOOLEAN NOT NULL DEFAULT false,
    "upstream_status" INTEGER,
    "upstream_accepted" BOOLEAN,
    "idempotency_key" TEXT NOT NULL,
    "batch_index" INTEGER NOT NULL,
    "server_received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coordinates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premise_geofences" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "polygon" JSONB NOT NULL,
    "min_lat" DOUBLE PRECISION NOT NULL,
    "min_lon" DOUBLE PRECISION NOT NULL,
    "max_lat" DOUBLE PRECISION NOT NULL,
    "max_lon" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "premise_geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_processing_jobs" (
    "id" SERIAL NOT NULL,
    "trip_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "pipeline_version" TEXT NOT NULL DEFAULT 'v1.0.0',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_processed_points" (
    "id" SERIAL NOT NULL,
    "trip_id" TEXT NOT NULL,
    "raw_point_id" INTEGER,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "sigma_m" DOUBLE PRECISION NOT NULL,
    "speed_mps" DOUBLE PRECISION NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pipeline_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_processed_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_stops" (
    "id" SERIAL NOT NULL,
    "trip_id" TEXT NOT NULL,
    "anchor_lat" DOUBLE PRECISION NOT NULL,
    "anchor_lon" DOUBLE PRECISION NOT NULL,
    "arrival_ts" TIMESTAMP(3) NOT NULL,
    "departure_ts" TIMESTAMP(3) NOT NULL,
    "dwell_s" DOUBLE PRECISION NOT NULL,
    "n_points" INTEGER NOT NULL,
    "radius_m" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "absorbed_raw_ids" INTEGER[],
    "pipeline_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_segments" (
    "id" SERIAL NOT NULL,
    "trip_id" TEXT NOT NULL,
    "segment_type" TEXT NOT NULL,
    "start_ts" TIMESTAMP(3) NOT NULL,
    "end_ts" TIMESTAMP(3) NOT NULL,
    "coordinates" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "data_version" TEXT,
    "pipeline_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_distance_summaries" (
    "id" SERIAL NOT NULL,
    "trip_id" TEXT NOT NULL,
    "distance_final_m" DOUBLE PRECISION NOT NULL,
    "distance_smoothed_m" DOUBLE PRECISION NOT NULL,
    "distance_raw_filtered_m" DOUBLE PRECISION NOT NULL,
    "distance_doppler_m" DOUBLE PRECISION NOT NULL,
    "distance_odometer_m" DOUBLE PRECISION,
    "error_odometer_pct" DOUBLE PRECISION,
    "error_raw_vs_odometer_pct" DOUBLE PRECISION,
    "n_raw" INTEGER NOT NULL,
    "n_rejected" INTEGER NOT NULL,
    "n_stop_points" INTEGER NOT NULL,
    "n_chunks" INTEGER NOT NULL,
    "trigger_reason" TEXT,
    "params_hash" TEXT NOT NULL,
    "simplified_polyline" TEXT,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pipeline_version" TEXT NOT NULL,

    CONSTRAINT "trip_distance_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_keys_device_id_key" ON "device_keys"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "trips_trip_id_key" ON "trips"("trip_id");

-- CreateIndex
CREATE INDEX "coordinates_trip_id_idx" ON "coordinates"("trip_id");

-- CreateIndex
CREATE INDEX "coordinates_device_id_idx" ON "coordinates"("device_id");

-- CreateIndex
CREATE INDEX "coordinates_device_time_idx" ON "coordinates"("device_time");

-- CreateIndex
CREATE UNIQUE INDEX "coordinates_idempotency_key_batch_index_key" ON "coordinates"("idempotency_key", "batch_index");

-- CreateIndex
CREATE INDEX "premise_geofences_min_lat_max_lat_min_lon_max_lon_idx" ON "premise_geofences"("min_lat", "max_lat", "min_lon", "max_lon");

-- CreateIndex
CREATE INDEX "trip_processing_jobs_status_run_at_idx" ON "trip_processing_jobs"("status", "run_at");

-- CreateIndex
CREATE INDEX "trip_processing_jobs_trip_id_idx" ON "trip_processing_jobs"("trip_id");

-- CreateIndex
CREATE INDEX "trip_processed_points_trip_id_pipeline_version_idx" ON "trip_processed_points"("trip_id", "pipeline_version");

-- CreateIndex
CREATE INDEX "trip_processed_points_trip_id_ts_idx" ON "trip_processed_points"("trip_id", "ts");

-- CreateIndex
CREATE INDEX "trip_stops_trip_id_pipeline_version_idx" ON "trip_stops"("trip_id", "pipeline_version");

-- CreateIndex
CREATE INDEX "trip_segments_trip_id_pipeline_version_idx" ON "trip_segments"("trip_id", "pipeline_version");

-- CreateIndex
CREATE UNIQUE INDEX "trip_distance_summaries_trip_id_key" ON "trip_distance_summaries"("trip_id");

-- CreateIndex
CREATE INDEX "trip_distance_summaries_trip_id_pipeline_version_idx" ON "trip_distance_summaries"("trip_id", "pipeline_version");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_keys"("device_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coordinates" ADD CONSTRAINT "coordinates_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_processed_points" ADD CONSTRAINT "trip_processed_points_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_segments" ADD CONSTRAINT "trip_segments_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_distance_summaries" ADD CONSTRAINT "trip_distance_summaries_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

