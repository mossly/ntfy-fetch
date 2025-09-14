import axios from 'axios';
import { BaseDataProvider } from '../base/DataProvider';
import { TideData, NOAAResponse, TidePrediction } from '../../types';
import { TimezoneHelper } from '../../utils/timezone';
import { logger } from '../../utils/logger';

interface NOAAParams {
  station: string;
  days?: number;
}

export class NOAAProvider extends BaseDataProvider<TideData> {
  private static readonly BASE_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
  private timezoneHelper: TimezoneHelper;

  constructor() {
    super('noaa-tide-data', 24); // Cache for 24 hours
    this.timezoneHelper = new TimezoneHelper();
  }

  async fetch(params: NOAAParams): Promise<TideData> {
    const { station, days = 7 } = params;

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    const queryParams = {
      station,
      product: 'predictions',
      begin_date: this.formatDate(startDate),
      end_date: this.formatDate(endDate),
      datum: 'MLLW', // Mean Lower Low Water
      time_zone: 'gmt',
      units: 'metric',
      interval: 'hilo', // High/Low tides only
      format: 'json',
      application: process.env.NOAA_APPLICATION_NAME || 'ntfy-fetch'
    };

    try {
      logger.info(`Fetching tide data from NOAA for station ${station}`);

      const response = await axios.get<NOAAResponse>(NOAAProvider.BASE_URL, {
        params: queryParams,
        timeout: 30000, // 30 second timeout
        headers: {
          'User-Agent': 'ntfy-fetch/1.0.0'
        }
      });

      if (response.data.error) {
        throw new Error(`NOAA API Error: ${response.data.error.message}`);
      }

      if (!response.data.predictions || response.data.predictions.length === 0) {
        throw new Error('No tide predictions received from NOAA API');
      }

      const tideData: TideData = {
        predictions: this.parsePredictions(response.data.predictions),
        station,
        units: 'metric',
        timeZone: 'UTC',
        fetchedAt: new Date()
      };

      logger.info(`Successfully fetched ${tideData.predictions.length} tide predictions`);

      return tideData;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          throw new Error('NOAA API request timeout');
        }
        if (error.response) {
          throw new Error(`NOAA API HTTP Error: ${error.response.status} - ${error.response.statusText}`);
        }
        if (error.request) {
          throw new Error('Failed to connect to NOAA API');
        }
      }

      throw error;
    }
  }

  private parsePredictions(predictions: NOAAResponse['predictions']): TidePrediction[] {
    if (!predictions) {
      return [];
    }

    return predictions
      .map(pred => {
        try {
          // Parse NOAA time format and convert to proper Date object
          const time = this.timezoneHelper.parseNoaaTime(pred.t);
          const height = parseFloat(pred.v);
          const type = pred.type as 'H' | 'L';

          if (isNaN(height)) {
            logger.warn(`Invalid height value: ${pred.v} for time ${pred.t}`);
            return null;
          }

          return {
            time,
            height,
            type
          };
        } catch (error) {
          logger.warn(`Failed to parse prediction: ${JSON.stringify(pred)}`, error);
          return null;
        }
      })
      .filter((pred): pred is TidePrediction => pred !== null)
      .sort((a, b) => a.time.getTime() - b.time.getTime());
  }

  private formatDate(date: Date): string {
    // Format as YYYYMMDD for NOAA API
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}${month}${day}`;
  }

  async getNextHighTide(): Promise<TidePrediction | null> {
    try {
      const data = await this.fetchWithCache({
        station: process.env.NOAA_STATION_ID || 'TPT2853'
      });

      const now = new Date();
      const nextHighTide = data.predictions.find(pred =>
        pred.type === 'H' && pred.time > now
      );

      return nextHighTide || null;
    } catch (error) {
      logger.error('Failed to get next high tide:', error);
      return null;
    }
  }

  async getNextLowTide(): Promise<TidePrediction | null> {
    try {
      const data = await this.fetchWithCache({
        station: process.env.NOAA_STATION_ID || 'TPT2853'
      });

      const now = new Date();
      const nextLowTide = data.predictions.find(pred =>
        pred.type === 'L' && pred.time > now
      );

      return nextLowTide || null;
    } catch (error) {
      logger.error('Failed to get next low tide:', error);
      return null;
    }
  }

  async getTodaysTides(): Promise<TidePrediction[]> {
    try {
      const data = await this.fetchWithCache({
        station: process.env.NOAA_STATION_ID || 'TPT2853',
        days: 1
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      return data.predictions.filter(pred =>
        pred.time >= today && pred.time < tomorrow
      );
    } catch (error) {
      logger.error('Failed to get today\'s tides:', error);
      return [];
    }
  }
}