import { redisManager } from '../redis.js';
import logger from '../logger.js';

export interface DeviceApiKeyRecord {
  deviceId: string;
  apiKey: string;
  telemetryEndpoint: string;
  updatedAt: Date;
}

export interface IDeviceKeyRepository {
  upsert(deviceId: string, apiKey: string, telemetryEndpoint: string): Promise<DeviceApiKeyRecord>;
  findByDeviceId(deviceId: string): Promise<DeviceApiKeyRecord | null>;
  delete?(deviceId: string): Promise<boolean>;
}

/**
 * Redis-backed repository for storing device telemetry API keys.
 * Uses the RedisManager singleton.
 * If Redis is temporarily unreachable or offline during local development,
 * gracefully falls back to an in-memory Map so the server functions reliably.
 */
export class RedisDeviceKeyRepository implements IDeviceKeyRepository {
  private readonly memoryStore = new Map<string, DeviceApiKeyRecord>();
  private readonly keyPrefix = 'device_key:';

  private formatKey(deviceId: string): string {
    return `${this.keyPrefix}${deviceId}`;
  }

  /**
   * Save or update the telemetry api_key and endpoint for a device.
   */
  async upsert(
    deviceId: string,
    apiKey: string,
    telemetryEndpoint: string
  ): Promise<DeviceApiKeyRecord> {
    const record: DeviceApiKeyRecord = {
      deviceId,
      apiKey,
      telemetryEndpoint,
      updatedAt: new Date(),
    };

    // Always keep memory store up to date as backup
    this.memoryStore.set(deviceId, record);

    const client = redisManager.getClient();
    if (redisManager.isAvailable() && client) {
      try {
        await client.set(
          this.formatKey(deviceId),
          JSON.stringify({
            deviceId,
            apiKey,
            telemetryEndpoint,
            updatedAt: record.updatedAt.toISOString(),
          })
        );
      } catch (err: any) {
        logger.warn('Failed to write device key to Redis; saved to in-memory store', {
          deviceId,
          error: err?.message,
        });
      }
    }

    return record;
  }

  /**
   * Look up stored telemetry credentials for a device.
   */
  async findByDeviceId(deviceId: string): Promise<DeviceApiKeyRecord | null> {
    const client = redisManager.getClient();
    if (redisManager.isAvailable() && client) {
      try {
        const raw = await client.get(this.formatKey(deviceId));
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            deviceId: parsed.deviceId,
            apiKey: parsed.apiKey,
            telemetryEndpoint: parsed.telemetryEndpoint,
            updatedAt: new Date(parsed.updatedAt),
          };
        }
      } catch (err: any) {
        logger.warn('Failed to read device key from Redis; checking in-memory store', {
          deviceId,
          error: err?.message,
        });
      }
    }

    // Fallback to memory store
    return this.memoryStore.get(deviceId) || null;
  }

  async delete(deviceId: string): Promise<boolean> {
    this.memoryStore.delete(deviceId);
    const client = redisManager.getClient();
    if (redisManager.isAvailable() && client) {
      try {
        const deleted = await client.del(this.formatKey(deviceId));
        return deleted > 0;
      } catch (err: any) {
        logger.warn('Failed to delete device key from Redis', { deviceId, error: err?.message });
      }
    }
    return true;
  }
}

// Default export alias for backwards-compatibility
export { RedisDeviceKeyRepository as DrizzleDeviceKeyRepository };
