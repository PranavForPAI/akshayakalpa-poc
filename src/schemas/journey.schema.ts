import { z } from 'zod';

export const phoneQuerySchema = z.object({
  phone: z.string().min(1, 'Phone is required'),
});

export const startJourneySchema = z.object({
  phone: z.string().min(1, 'Phone is required'),
  start: z.string().datetime().optional(),
});

export const endJourneySchema = z.object({
  phone: z.string().min(1, 'Phone is required'),
  stop: z.string().datetime().optional(),
});

export const singleCoordinateSchema = z.object({
  latitude: z.number({ required_error: 'latitude is required' }),
  longitude: z.number({ required_error: 'longitude is required' }),
  sequence: z.number({ required_error: 'sequence is required' }),
  recorded_at: z.string().datetime().optional(),
});

export const trackSchema = z.object({
  phone: z.string().min(1, 'Phone is required'),
  journey_id: z.number().int().positive().optional(),
  coordinates: z.union([
    singleCoordinateSchema,
    z.array(singleCoordinateSchema).min(1, 'Coordinates list must not be empty'),
  ]),
});

export type PhoneQueryDto = z.infer<typeof phoneQuerySchema>;
export type StartJourneyDto = z.infer<typeof startJourneySchema>;
export type EndJourneyDto = z.infer<typeof endJourneySchema>;
export type SingleCoordinateDto = z.infer<typeof singleCoordinateSchema>;
export type TrackDto = z.infer<typeof trackSchema>;
