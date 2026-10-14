import winston from 'winston';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// ---------------------------------------------------------------------------
// Human-readable format for development
// ---------------------------------------------------------------------------

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? '\n' + JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}] ${message}${stack ? '\n' + stack : ''}${metaStr}`;
  })
);

// ---------------------------------------------------------------------------
// Structured JSON format for production
// ---------------------------------------------------------------------------

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const isProduction = process.env.NODE_ENV === 'production';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: isProduction ? prodFormat : devFormat,
  defaultMeta: { service: 'akshayakalpa-be' },
  transports: [
    new winston.transports.Console(),
  ],
});

export default logger;
