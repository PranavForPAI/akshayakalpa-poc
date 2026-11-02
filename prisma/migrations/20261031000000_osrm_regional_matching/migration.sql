-- AlterTable
ALTER TABLE "trip_segments" ADD COLUMN     "region_id" TEXT,
ADD COLUMN     "reject_reason" TEXT;

-- CreateTable
CREATE TABLE "osrm_region" (
    "region_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "polygon" JSONB NOT NULL,
    "min_lon" DOUBLE PRECISION NOT NULL,
    "min_lat" DOUBLE PRECISION NOT NULL,
    "max_lon" DOUBLE PRECISION NOT NULL,
    "max_lat" DOUBLE PRECISION NOT NULL,
    "osrm_url" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data_version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "osrm_region_pkey" PRIMARY KEY ("region_id")
);

-- CreateTable
CREATE TABLE "trip_matching_summaries" (
    "id" SERIAL NOT NULL,
    "trip_id" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "n_runs" INTEGER NOT NULL,
    "n_matched" INTEGER NOT NULL,
    "n_unmatched" INTEGER NOT NULL,
    "matched_share" DOUBLE PRECISION NOT NULL,
    "regions_used" TEXT[],
    "reject_reasons" JSONB NOT NULL,
    "http_ms" INTEGER NOT NULL,
    "pipeline_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_matching_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "osrm_region_enabled_kind_idx" ON "osrm_region"("enabled", "kind");

-- CreateIndex
CREATE INDEX "trip_matching_summaries_trip_id_pipeline_version_idx" ON "trip_matching_summaries"("trip_id", "pipeline_version");

-- AddForeignKey
ALTER TABLE "trip_matching_summaries" ADD CONSTRAINT "trip_matching_summaries_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

