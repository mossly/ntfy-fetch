import { BasePlugin } from '../base/Plugin';
import { NotificationData, ScheduleConfig, PluginConfig, PluginMetadata } from '../../types';
import { CronExpressionBuilder, NotificationScheduler } from '../../utils/scheduling';
import { CoinGeckoDataProvider, CoinGeckoPrice, CoinGeckoPriceHistory } from './CoinGeckoDataProvider';

interface AdaPriceConfig {
  vs_currency: string;
  dailyNotification: {
    enabled: boolean;
    time: string; // HH:mm format
  };
  flashCrashDetection: {
    enabled: boolean;
    priceHistoryDays: number;
    standardDeviationThreshold: number;
    movingAveragePeriod: number;
  };
}

interface PriceHistoryEntry {
  timestamp: Date;
  price: number;
}

export class AdaPricePlugin extends BasePlugin {
  private scheduler: NotificationScheduler;
  private dataProvider: CoinGeckoDataProvider;
  private priceHistory: PriceHistoryEntry[] = [];
  private adaConfig: AdaPriceConfig;

  constructor(pluginConfig: PluginConfig) {
    const metadata: PluginMetadata = {
      name: 'ada-price',
      version: '1.0.0',
      description: 'Monitors Cardano (ADA) price with daily notifications and flash crash/boom detection',
      author: 'ntfy-fetch',
      dependencies: []
    };

    super(pluginConfig, metadata);

    this.adaConfig = this.getPluginConfig<AdaPriceConfig>();
    this.scheduler = new NotificationScheduler('ada-price', 24);
    this.dataProvider = new CoinGeckoDataProvider({
      vs_currency: this.adaConfig.vs_currency || 'usd',
      coin_id: 'cardano'
    }, 20); // 20 minute cache for flash crash detection
  }

  getSchedules(): ScheduleConfig[] {
    const schedules: ScheduleConfig[] = [];

    // Daily notification schedule
    if (this.adaConfig.dailyNotification?.enabled) {
      schedules.push({
        expression: CronExpressionBuilder.daily(this.adaConfig.dailyNotification.time),
        description: 'Daily ADA price notification',
        enabled: this.enabled
      });
    }

    // Hourly flash crash/boom detection
    if (this.adaConfig.flashCrashDetection?.enabled) {
      schedules.push({
        expression: CronExpressionBuilder.everyHours(1),
        description: 'Flash crash/boom detection',
        enabled: this.enabled
      });
    }

    return schedules;
  }

  async checkConditions(context?: { description?: string }): Promise<NotificationData[]> {
    if (!this.enabled) {
      return [];
    }

    const notifications: NotificationData[] = [];

    try {
      // Fetch current price data
      const priceData = await this.dataProvider.fetch();

      if (context?.description?.includes('Daily ADA price notification')) {
        const dailyNotification = await this.handleDailyNotification(priceData);
        if (dailyNotification) {
          notifications.push(dailyNotification);
        }
      }

      if (context?.description?.includes('Flash crash/boom detection')) {
        const flashNotifications = await this.handleFlashDetection(priceData);
        notifications.push(...flashNotifications);
      }

    } catch (error) {
      this.log('error', 'Failed to check ADA price conditions', error);
    }

    return notifications;
  }

  private async handleDailyNotification(priceData: CoinGeckoPrice): Promise<NotificationData | null> {
    if (!this.scheduler.shouldSendDailySummary({
      enabled: this.adaConfig.dailyNotification.enabled,
      time: this.adaConfig.dailyNotification.time,
      windowMinutes: 5
    })) {
      return null;
    }

    this.scheduler.markDailySummaryAsSent();

    const currency = this.adaConfig.vs_currency.toUpperCase();
    const price = priceData.current_price;
    const change24h = priceData.price_change_percentage_24h_in_currency || 0;
    const changeEmoji = change24h >= 0 ? '📈' : '📉';
    const changeText = change24h >= 0 ? '+' : '';

    return {
      title: `ADA Price Update`,
      message: `${changeEmoji} $${price.toFixed(4)} ${currency}\n24h Change: ${changeText}${change24h.toFixed(2)}%`,
      priority: 'default'
    };
  }

  private async handleFlashDetection(priceData: CoinGeckoPrice): Promise<NotificationData[]> {
    if (!this.adaConfig.flashCrashDetection?.enabled) {
      return [];
    }

    const notifications: NotificationData[] = [];

    try {
      // Add current price to history
      this.updatePriceHistory(priceData);

      // Need at least enough data points for moving average
      const minDataPoints = this.adaConfig.flashCrashDetection.movingAveragePeriod + 1;
      if (this.priceHistory.length < minDataPoints) {
        this.log('debug', `Insufficient price history: ${this.priceHistory.length}/${minDataPoints} points`);
        return [];
      }

      // Calculate if current price represents a flash crash or boom
      const anomaly = this.detectPriceAnomaly(priceData.current_price);

      if (anomaly) {
        const eventKey = `flash-${anomaly.type}-${new Date().toISOString().slice(0, 13)}`; // hourly uniqueness

        if (!this.scheduler.getTracker().hasBeenSent(eventKey)) {
          this.scheduler.getTracker().markAsSent(eventKey);

          const currency = this.adaConfig.vs_currency.toUpperCase();
          const emoji = anomaly.type === 'crash' ? '🚨' : '🚀';
          const typeText = anomaly.type === 'crash' ? 'FLASH CRASH' : 'FLASH BOOM';

          notifications.push({
            title: `${emoji} ADA ${typeText} DETECTED`,
            message: `Price: $${priceData.current_price.toFixed(4)} ${currency}\nDeviation: ${anomaly.deviations.toFixed(2)}σ from MA\nMA(${this.adaConfig.flashCrashDetection.movingAveragePeriod}): $${anomaly.movingAverage.toFixed(4)}`,
            priority: 'high'
          });
        }
      }

    } catch (error) {
      this.log('error', 'Failed to detect flash crash/boom', error);
    }

    return notifications;
  }

  private updatePriceHistory(priceData: CoinGeckoPrice): void {
    const entry: PriceHistoryEntry = {
      timestamp: new Date(),
      price: priceData.current_price
    };

    this.priceHistory.push(entry);

    // Keep only the last N hours of data (for moving average calculation)
    const maxEntries = this.adaConfig.flashCrashDetection.movingAveragePeriod * 2; // Buffer for safety
    if (this.priceHistory.length > maxEntries) {
      this.priceHistory = this.priceHistory.slice(-maxEntries);
    }

    this.log('debug', `Price history updated: ${this.priceHistory.length} entries, latest: $${entry.price}`);
  }

  private detectPriceAnomaly(currentPrice: number): { type: 'crash' | 'boom', deviations: number, movingAverage: number } | null {
    const period = this.adaConfig.flashCrashDetection.movingAveragePeriod;
    const threshold = this.adaConfig.flashCrashDetection.standardDeviationThreshold;

    if (this.priceHistory.length < period) {
      return null;
    }

    // Get the last N prices for moving average calculation (excluding current)
    const recentPrices = this.priceHistory.slice(-period).map(entry => entry.price);

    // Calculate moving average
    const movingAverage = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;

    // Calculate standard deviation
    const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - movingAverage, 2), 0) / recentPrices.length;
    const standardDeviation = Math.sqrt(variance);

    if (standardDeviation === 0) {
      return null; // No volatility to detect anomalies
    }

    // Calculate how many standard deviations the current price is from the moving average
    const deviations = (currentPrice - movingAverage) / standardDeviation;

    this.log('debug', `Price anomaly check: current=$${currentPrice}, MA=$${movingAverage.toFixed(4)}, σ=${standardDeviation.toFixed(4)}, deviations=${deviations.toFixed(2)}`);

    // Check for flash crash (price significantly below moving average)
    if (deviations <= -threshold) {
      return { type: 'crash', deviations: Math.abs(deviations), movingAverage };
    }

    // Check for flash boom (price significantly above moving average)
    if (deviations >= threshold) {
      return { type: 'boom', deviations, movingAverage };
    }

    return null;
  }

  protected async onInitialize(): Promise<void> {
    this.log('info', 'ADA Price Plugin initialized');

    // Test basic price fetch to ensure API is working
    try {
      const priceData = await this.dataProvider.fetch();
      this.log('info', `Current ADA price: $${priceData.current_price} ${this.adaConfig.vs_currency.toUpperCase()}`);
    } catch (error) {
      this.log('warn', 'Failed to fetch current ADA price during initialization', error);
    }
  }

  protected async onCleanup(): Promise<void> {
    this.scheduler.cleanup();
    this.log('info', 'ADA Price Plugin cleaned up');
  }

  private async loadInitialPriceHistory(): Promise<void> {
    try {
      const historyDays = this.adaConfig.flashCrashDetection.priceHistoryDays || 1;
      const historyData = await this.dataProvider.fetchPriceHistory(historyDays);

      // Convert price history to our format (last 24 entries for hourly data)
      const entries = historyData.prices
        .slice(-24) // Last 24 hours
        .map(([timestamp, price]) => ({
          timestamp: new Date(timestamp),
          price
        }));

      this.priceHistory = entries;
      this.log('info', `Loaded ${entries.length} price history entries`);

    } catch (error) {
      this.log('warn', 'Could not load initial price history, will build it over time', error);
    }
  }
}
