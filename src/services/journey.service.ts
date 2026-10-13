import {
  IJourneyRepository,
  ICoordinateRepository,
  DrizzleJourneyRepository,
  DrizzleCoordinateRepository,
} from '../repositories/journey.repository.js';
import { Journey, Coordinate } from '../db/schema.js';
import { StartJourneyDto, EndJourneyDto, TrackDto } from '../schemas/journey.schema.js';

export class ConflictError extends Error {
  constructor(message: string, public data?: any) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class JourneyService {
  constructor(
    private readonly journeyRepo: IJourneyRepository = new DrizzleJourneyRepository(),
    private readonly coordinateRepo: ICoordinateRepository = new DrizzleCoordinateRepository()
  ) {}

  async startJourney(dto: StartJourneyDto): Promise<Journey> {
    const existingActive = await this.journeyRepo.findActiveByPhone(dto.phone);
    if (existingActive) {
      throw new ConflictError(
        'An active journey already exists for this phone. Please end it before starting a new one.',
        existingActive
      );
    }

    const startDate = dto.start ? new Date(dto.start) : undefined;
    return this.journeyRepo.create(dto.phone, startDate);
  }

  async endJourney(dto: EndJourneyDto): Promise<Journey> {
    const stopDate = dto.stop ? new Date(dto.stop) : new Date();
    const ended = await this.journeyRepo.endJourney(dto.phone, stopDate);

    if (!ended) {
      throw new NotFoundError('No active journey found for this phone number to end.');
    }

    return ended;
  }

  async trackCoordinates(dto: TrackDto): Promise<{ journeyId: number; coordinates: Coordinate[] }> {
    let journeyId = dto.journey_id;

    if (!journeyId) {
      const activeJourney = await this.journeyRepo.findActiveByPhone(dto.phone);
      if (!activeJourney) {
        throw new NotFoundError(
          'No active journey found for this phone number. Please start a journey before pushing coordinates.'
        );
      }
      journeyId = activeJourney.id;
    } else {
      const existingJourney = await this.journeyRepo.findById(journeyId);
      if (!existingJourney || existingJourney.phone !== dto.phone) {
        throw new NotFoundError('Journey not found for the specified phone number.');
      }
      if (existingJourney.stop !== null) {
        throw new ValidationError('Cannot push coordinates to an already ended journey.');
      }
    }

    const coordList = Array.isArray(dto.coordinates) ? dto.coordinates : [dto.coordinates];

    const recordsToInsert = coordList.map((c) => ({
      journeyId,
      latitude: c.latitude,
      longitude: c.longitude,
      sequence: c.sequence,
      recordedAt: c.recorded_at ? new Date(c.recorded_at) : new Date(),
    }));

    const inserted = await this.coordinateRepo.insertBatch(recordsToInsert);

    return {
      journeyId,
      coordinates: inserted,
    };
  }

  async getCurrentJourney(phone: string): Promise<{ journey: Journey & { status: string }; coordinates: Coordinate[] }> {
    const active = await this.journeyRepo.findActiveByPhone(phone);
    if (!active) {
      throw new NotFoundError('No active journey found for this phone number.');
    }

    const coords = await this.coordinateRepo.findByJourneyId(active.id);

    return {
      journey: {
        ...active,
        status: 'active',
      },
      coordinates: coords,
    };
  }

  async getAllJourneys(phone?: string): Promise<(Journey & { status: string })[]> {
    const journeys = await this.journeyRepo.findAll(phone);
    return journeys.map((j) => ({
      ...j,
      status: j.stop === null ? 'active' : 'completed',
    }));
  }

  async getJourneyById(id: number): Promise<{ journey: Journey & { status: string }; coordinates: Coordinate[] }> {
    const journeyRecord = await this.journeyRepo.findById(id);
    if (!journeyRecord) {
      throw new NotFoundError('Journey not found.');
    }

    const coords = await this.coordinateRepo.findByJourneyId(id);

    return {
      journey: {
        ...journeyRecord,
        status: journeyRecord.stop === null ? 'active' : 'completed',
      },
      coordinates: coords,
    };
  }
}
