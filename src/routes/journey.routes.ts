import { Router } from 'express';
import { JourneyController } from '../controllers/journey.controller.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import {
  startJourneySchema,
  endJourneySchema,
  trackSchema,
  phoneQuerySchema,
} from '../schemas/journey.schema.js';

export const createJourneyRouter = (controller: JourneyController = new JourneyController()): Router => {
  const router = Router();

  // 1. Start journey
  router.post('/start', validateBody(startJourneySchema), controller.start);

  // 2. End journey
  router.post('/end', validateBody(endJourneySchema), controller.end);

  // 3. Track coordinates (single or batch)
  router.post('/track', validateBody(trackSchema), controller.track);

  // 4. Get current journey by phone query parameter (?phone=...)
  router.get('/journey/current', validateQuery(phoneQuerySchema), controller.getCurrentJourney);

  // 5. Get all journeys (optional ?phone=...)
  router.get('/journeys', controller.getAllJourneys);

  // 6. Get journey by specific ID
  router.get('/journey/:id', controller.getJourneyById);

  return router;
};

export const journeyRouter = createJourneyRouter();
