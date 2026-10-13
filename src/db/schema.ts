import { pgTable, serial, varchar, timestamp, doublePrecision, integer, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const journey = pgTable(
  'journey',
  {
    id: serial('id').primaryKey(),
    phone: varchar('phone', { length: 20 }).notNull(),
    start: timestamp('start', { withTimezone: true }).defaultNow().notNull(),
    stop: timestamp('stop', { withTimezone: true }),
  },
  (table) => [
    index('idx_journey_phone_stop').on(table.phone, table.stop),
  ]
);

export const coordinates = pgTable(
  'coordinates',
  {
    id: serial('id').primaryKey(),
    journeyId: integer('journey_id')
      .notNull()
      .references(() => journey.id, { onDelete: 'cascade' }),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    sequence: integer('sequence').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_coordinates_journey_sequence').on(table.journeyId, table.sequence),
  ]
);

export const journeyRelations = relations(journey, ({ many }) => ({
  coordinates: many(coordinates),
}));

export const coordinatesRelations = relations(coordinates, ({ one }) => ({
  journey: one(journey, {
    fields: [coordinates.journeyId],
    references: [journey.id],
  }),
}));

export type Journey = typeof journey.$inferSelect;
export type NewJourney = typeof journey.$inferInsert;
export type Coordinate = typeof coordinates.$inferSelect;
export type NewCoordinate = typeof coordinates.$inferInsert;
