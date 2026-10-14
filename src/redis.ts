import Redis, { Redis as RedisClient } from 'ioredis';
import logger from './logger.js';

/**
 * Singleton Redis connection manager.
 * Supports REDIS_URL or host/port/password environment variables.
 * Maintains a single persistent client and handles reconnections gracefully.
 */
export class RedisManager {
  private static instance: RedisManager;
  private client: RedisClient | null = null;
  private connected: boolean = false;

  private constructor() {
    this.init();
  }

  public static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  private init(): void {
    const redisUrl = process.env.REDIS_URL;
    const redisHost = process.env.REDIS_HOST || '127.0.0.1';
    const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
    const redisPassword = process.env.REDIS_PASSWORD || undefined;

    const redisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => {
        if (times > 3) {
          return null; // Stop retrying after 3 attempts
        }
        return Math.min(times * 150, 1000);
      },
    };

    try {
      this.client = redisUrl
        ? new Redis(redisUrl, redisOptions)
        : new Redis({
            host: redisHost,
            port: redisPort,
            password: redisPassword,
            ...redisOptions,
          });

      this.client.on('connect', () => {
        this.connected = true;
        logger.info('Connected to Redis');
      });

      this.client.on('ready', () => {
        this.connected = true;
      });

      this.client.on('error', (err) => {
        this.connected = false;
        logger.warn('Redis client error; operating with in-memory fallback', {
          error: err.message,
        });
      });

      this.client.on('close', () => {
        this.connected = false;
      });

      // Connect asynchronously so application startup is never blocked
      this.client.connect().catch((err) => {
        this.connected = false;
        logger.warn('Redis unavailable at startup; using in-memory store fallback', {
          error: err.message,
        });
      });
    } catch (err: any) {
      this.connected = false;
      this.client = null;
      logger.warn('Failed to initialize Redis client; using in-memory store fallback', {
        error: err?.message,
      });
    }
  }

  public getClient(): RedisClient | null {
    return this.client;
  }

  public isAvailable(): boolean {
    return this.connected && this.client !== null && this.client.status === 'ready';
  }

  public async quit(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => {});
      this.client = null;
      this.connected = false;
    }
  }
}

export const getRedisClient = (): RedisClient | null => RedisManager.getInstance().getClient();
export const redisManager = RedisManager.getInstance();
export default RedisManager;
