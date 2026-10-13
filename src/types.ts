export interface Journey {
  id: number;
  phone: string;
  start: Date;
  stop: Date | null;
}

export interface Coordinate {
  id: number;
  journey_id: number;
  latitude: number;
  longitude: number;
  sequence: number;
  recorded_at?: Date;
}
