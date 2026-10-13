import { eq, and, isNull, desc, asc } from 'drizzle-orm';
import { db, Database } from '../db/index.js';
import { journey, coordinates, Journey, Coordinate, NewCoordinate } from '../db/schema.js';

export interface IJourneyRepository {
  findActiveByPhone(phone: string): Promise<Journey | null>;
  findById(id: number): Promise<Journey | null>;
  create(phone: string, start?: Date): Promise<Journey>;
  endJourney(phone: string, stop?: Date): Promise<Journey | null>;
  findAll(phone?: string): Promise<Journey[]>;
}

export interface ICoordinateRepository {
  insertBatch(items: NewCoordinate[]): Promise<Coordinate[]>;
  findByJourneyId(journeyId: number): Promise<Coordinate[]>;
}

export class DrizzleJourneyRepository implements IJourneyRepository {
  constructor(private readonly database: Database = db) {}

  async findActiveByPhone(phone: string): Promise<Journey | null> {
    const result = await this.database
      .select()
      .from(journey)
      .where(and(eq(journey.phone, phone), isNull(journey.stop)))
      .orderBy(desc(journey.start))
      .limit(1);

    return result[0] || null;
  }

  async findById(id: number): Promise<Journey | null> {
    const result = await this.database
      .select()
      .from(journey)
      .where(eq(journey.id, id))
      .limit(1);

    return result[0] || null;
  }

  async create(phone: string, start?: Date): Promise<Journey> {
    const result = await this.database
      .insert(journey)
      .values({
        phone,
        ...(start ? { start } : {}),
      })
      .returning();

    return result[0];
  }

  async endJourney(phone: string, stop: Date = new Date()): Promise<Journey | null> {
    const active = await this.findActiveByPhone(phone);
    if (!active) {
      return null;
    }

    const result = await this.database
      .update(journey)
      .set({ stop })
      .where(eq(journey.id, active.id))
      .returning();

    return result[0] || null;
  }

  async findAll(phone?: string): Promise<Journey[]> {
    if (phone) {
      return this.database
        .select()
        .from(journey)
        .where(eq(journey.phone, phone))
        .orderBy(desc(journey.start));
    }

    return this.database
      .select()
      .from(journey)
      .orderBy(desc(journey.start));
  }
}

export class DrizzleCoordinateRepository implements ICoordinateRepository {
  constructor(private readonly database: Database = db) {}

  async insertBatch(items: NewCoordinate[]): Promise<Coordinate[]> {
    if (items.length === 0) return [];
    return this.database.insert(coordinates).values(items).returning();
  }

  async findByJourneyId(journeyId: number): Promise<Coordinate[]> {
    return this.database
      .select()
      .from(coordinates)
      .where(eq(coordinates.journeyId, journeyId))
      .orderBy(asc(coordinates.sequence));
  }
}
