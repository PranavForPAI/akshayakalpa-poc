import { Request, Response } from 'express';
import { JourneyService, ConflictError, NotFoundError, ValidationError } from '../services/journey.service.js';
import { StartJourneyDto, EndJourneyDto, TrackDto } from '../schemas/journey.schema.js';

export class JourneyController {
  constructor(private readonly journeyService: JourneyService = new JourneyService()) {}

  start = async (req: Request<{}, {}, StartJourneyDto>, res: Response): Promise<void> => {
    try {
      const journey = await this.journeyService.startJourney(req.body);
      res.status(201).json({
        message: 'Journey started successfully',
        journey,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  end = async (req: Request<{}, {}, EndJourneyDto>, res: Response): Promise<void> => {
    try {
      const journey = await this.journeyService.endJourney(req.body);
      res.status(200).json({
        message: 'Journey ended successfully',
        journey,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  track = async (req: Request<{}, {}, TrackDto>, res: Response): Promise<void> => {
    try {
      const result = await this.journeyService.trackCoordinates(req.body);
      res.status(201).json({
        message: `Successfully saved ${result.coordinates.length} coordinate(s)`,
        journey_id: result.journeyId,
        inserted_count: result.coordinates.length,
        coordinates: result.coordinates,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  getCurrentJourney = async (req: Request, res: Response): Promise<void> => {
    try {
      const phone = req.query.phone as string;
      const result = await this.journeyService.getCurrentJourney(phone);
      res.status(200).json({
        journey: result.journey,
        coordinates_count: result.coordinates.length,
        coordinates: result.coordinates,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  getAllJourneys = async (req: Request, res: Response): Promise<void> => {
    try {
      const phone = req.query.phone as string | undefined;
      const journeys = await this.journeyService.getAllJourneys(phone);
      res.status(200).json({
        count: journeys.length,
        journeys,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  getJourneyById = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid journey id' });
        return;
      }

      const result = await this.journeyService.getJourneyById(id);
      res.status(200).json({
        journey: result.journey,
        coordinates_count: result.coordinates.length,
        coordinates: result.coordinates,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  private handleError(res: Response, error: any): void {
    if (error instanceof ConflictError) {
      res.status(409).json({ error: error.message, activeJourney: error.data });
      return;
    }
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }

    console.error('Unhandled Controller Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
