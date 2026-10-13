CREATE TABLE "coordinates" (
	"id" serial PRIMARY KEY NOT NULL,
	"journey_id" integer NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"sequence" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" varchar(20) NOT NULL,
	"start" timestamp with time zone DEFAULT now() NOT NULL,
	"stop" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "coordinates" ADD CONSTRAINT "coordinates_journey_id_journey_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_coordinates_journey_sequence" ON "coordinates" USING btree ("journey_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_journey_phone_stop" ON "journey" USING btree ("phone","stop");