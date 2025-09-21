import { BaseDataProvider } from '../base/DataProvider';
import { logger } from '../../utils/logger';

export interface CoinGeckoPrice {
  id: string;
  current_price: number;
  price_change_percentage_1h_in_currency?: number;
  price_change_percentage_24h_in_currency?: number;
  market_cap: number;
  total_volume: number;
  last_updated: Date;
}

export interface CoinGeckoPriceHistory {
  prices: Array<[number, number]>; // [timestamp, price]
  market_caps: Array<[number, number]>;
  total_volumes: Array<[number, number]>;
}

export interface CoinGeckoConfig {
  vs_currency: string;
  coin_id: string;
}

export class CoinGeckoDataProvider extends BaseDataProvider<CoinGeckoPrice> {
  private config: CoinGeckoConfig;
  private readonly baseUrl = 'https://api.coingecko.com/api/v3';

  constructor(config: CoinGeckoConfig, ttlMinutes: number = 60) {
    // Cache for 60 minutes for free API
    super(`coingecko-${config.coin_id}`, ttlMinutes / 60);
    this.config = config;
  }

  async fetch(): Promise<CoinGeckoPrice> {
    const url = new URL(`${this.baseUrl}/simple/price`);
    url.searchParams.append('ids', this.config.coin_id);
    url.searchParams.append('vs_currencies', this.config.vs_currency);
    url.searchParams.append('include_market_cap', 'true');
    url.searchParams.append('include_24hr_vol', 'true');
    url.searchParams.append('include_24hr_change', 'true');
    url.searchParams.append('include_last_updated_at', 'true');

    try {
      logger.debug(`Fetching CoinGecko data for ${this.config.coin_id}`);
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as Record<string, any>;

      if (!data[this.config.coin_id]) {
        throw new Error(`No data returned for ${this.config.coin_id}`);
      }

      const coin = data[this.config.coin_id];

      return {
        id: this.config.coin_id,
        current_price: coin[this.config.vs_currency],
        price_change_percentage_24h_in_currency: coin[`${this.config.vs_currency}_24h_change`],
        market_cap: coin[`${this.config.vs_currency}_market_cap`],
        total_volume: coin[`${this.config.vs_currency}_24h_vol`],
        last_updated: new Date(coin.last_updated_at * 1000)
      };
    } catch (error) {
      logger.error('Failed to fetch CoinGecko data:', error);
      throw error;
    }
  }

  async fetchPriceHistory(days: number = 1): Promise<CoinGeckoPriceHistory> {
    const url = new URL(`${this.baseUrl}/coins/${this.config.coin_id}/market_chart`);
    url.searchParams.append('vs_currency', this.config.vs_currency);
    url.searchParams.append('days', days.toString());
    url.searchParams.append('interval', days <= 1 ? 'hourly' : 'daily');

    try {
      logger.debug(`Fetching CoinGecko price history for ${this.config.coin_id} (${days} days)`);
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as CoinGeckoPriceHistory;
      return data;
    } catch (error) {
      logger.error('Failed to fetch CoinGecko price history:', error);
      throw error;
    }
  }

  protected rehydrateDates(data: CoinGeckoPrice): CoinGeckoPrice {
    return {
      ...data,
      last_updated: new Date(data.last_updated)
    };
  }
}