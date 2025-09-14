import { IDataProvider, CachedData } from '../../types';
import { logger } from '../../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

export abstract class BaseDataProvider<T> implements IDataProvider<T> {
  protected cachePath: string;
  protected ttlHours: number;

  constructor(cacheKey: string, ttlHours: number = 24) {
    this.cachePath = path.join(process.cwd(), 'data', `${cacheKey}.json`);
    this.ttlHours = ttlHours;
  }

  abstract fetch(params: Record<string, any>): Promise<T>;

  async cache(data: T): Promise<void> {
    try {
      const cachedData: CachedData<T> = {
        data,
        timestamp: new Date(),
        expiresAt: new Date(Date.now() + this.ttlHours * 60 * 60 * 1000)
      };

      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      await fs.writeFile(this.cachePath, JSON.stringify(cachedData, null, 2));

      logger.debug(`Data cached to ${this.cachePath}`);
    } catch (error) {
      logger.error('Failed to cache data:', error);
    }
  }

  async getCached(): Promise<T | null> {
    try {
      const content = await fs.readFile(this.cachePath, 'utf-8');
      const cachedData: CachedData<T> = JSON.parse(content);

      if (new Date() > new Date(cachedData.expiresAt)) {
        logger.debug('Cached data expired');
        return null;
      }

      logger.debug('Using cached data');

      // Fix: Re-hydrate Date objects after JSON parsing
      const rehydratedData = this.rehydrateDates(cachedData.data);
      return rehydratedData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Failed to read cached data:', error);
      }
      return null;
    }
  }

  // Override this method in subclasses to handle Date re-hydration
  protected rehydrateDates(data: T): T {
    return data; // Base implementation does nothing
  }

  async isStale(): Promise<boolean> {
    try {
      const content = await fs.readFile(this.cachePath, 'utf-8');
      const cachedData: CachedData<T> = JSON.parse(content);

      return new Date() > new Date(cachedData.expiresAt);
    } catch (error) {
      return true; // Consider missing cache as stale
    }
  }

  protected async fetchWithCache(params: Record<string, any>): Promise<T> {
    const cached = await this.getCached();

    if (cached !== null) {
      return cached;
    }

    logger.info('Cache miss or expired, fetching fresh data');
    const freshData = await this.fetch(params);
    await this.cache(freshData);

    return freshData;
  }
}