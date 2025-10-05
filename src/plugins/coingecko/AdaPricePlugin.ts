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
    percentageThreshold: number; // e.g., 10 for ±10%
    timeWindowMinutes: number; // e.g., 60 for 1 hour
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
    }, 5); // 5 minute cache for more frequent flash detection checks
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

    // Flash crash/boom detection - check every 5 minutes
    if (this.adaConfig.flashCrashDetection?.enabled) {
      schedules.push({
        expression: CronExpressionBuilder.everyMinutes(5),
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

      // Need at least 2 data points to compare
      if (this.priceHistory.length < 2) {
        this.log('debug', `Insufficient price history: ${this.priceHistory.length} points`);
        return [];
      }

      // Calculate if current price represents a flash crash or boom
      const anomaly = this.detectPriceAnomaly(priceData.current_price);

      if (anomaly) {
        const eventKey = `flash-${anomaly.type}-${new Date().toISOString().slice(0, 13)}`; // hourly uniqueness to prevent spam

        if (!this.scheduler.getTracker().hasBeenSent(eventKey)) {
          this.scheduler.getTracker().markAsSent(eventKey);

          const currency = this.adaConfig.vs_currency.toUpperCase();
          const emoji = anomaly.type === 'crash' ? '🚨' : '🚀';
          const typeText = anomaly.type === 'crash' ? 'FLASH CRASH' : 'FLASH BOOM';

          notifications.push({
            title: `${emoji} ADA ${typeText} DETECTED`,
            message: `Current: $${priceData.current_price.toFixed(4)} ${currency}\nChange: ${anomaly.changePercent.toFixed(2)}% in ${anomaly.timeWindowMins} minutes\nPrevious: $${anomaly.previousPrice.toFixed(4)}`,
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

    // Keep price history for the configured time window + some buffer
    const timeWindowMs = this.adaConfig.flashCrashDetection.timeWindowMinutes * 60 * 1000;
    const bufferMs = 30 * 60 * 1000; // 30 minutes buffer
    const cutoffTime = Date.now() - timeWindowMs - bufferMs;

    this.priceHistory = this.priceHistory.filter(entry => entry.timestamp.getTime() >= cutoffTime);

    this.log('debug', `Price history updated: ${this.priceHistory.length} entries, latest: $${entry.price}`);
  }

  private detectPriceAnomaly(currentPrice: number): {
    type: 'crash' | 'boom',
    changePercent: number,
    previousPrice: number,
    timeWindowMins: number
  } | null {
    const percentageThreshold = this.adaConfig.flashCrashDetection.percentageThreshold;
    const timeWindowMinutes = this.adaConfig.flashCrashDetection.timeWindowMinutes;

    if (this.priceHistory.length < 2) {
      return null;
    }

    // Find the price from approximately N minutes ago
    const targetTime = Date.now() - (timeWindowMinutes * 60 * 1000);

    // Find the closest historical price to our target time
    let closestEntry = this.priceHistory[0];
    let minTimeDiff = Math.abs(closestEntry.timestamp.getTime() - targetTime);

    for (const entry of this.priceHistory) {
      const timeDiff = Math.abs(entry.timestamp.getTime() - targetTime);
      if (timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff;
        closestEntry = entry;
      }
    }

    const previousPrice = closestEntry.price;
    const actualTimeWindowMins = Math.round((Date.now() - closestEntry.timestamp.getTime()) / 60000);

    // Calculate percentage change
    const changePercent = ((currentPrice - previousPrice) / previousPrice) * 100;

    this.log('debug', `Price anomaly check: current=$${currentPrice}, previous=$${previousPrice.toFixed(4)} (${actualTimeWindowMins}m ago), change=${changePercent.toFixed(2)}%`);

    // Check for flash crash (price dropped by threshold%)
    if (changePercent <= -percentageThreshold) {
      return { type: 'crash', changePercent, previousPrice, timeWindowMins: actualTimeWindowMins };
    }

    // Check for flash boom (price increased by threshold%)
    if (changePercent >= percentageThreshold) {
      return { type: 'boom', changePercent, previousPrice, timeWindowMins: actualTimeWindowMins };
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
      // Fetch 1 day of historical data to populate initial price history
      const historyData = await this.dataProvider.fetchPriceHistory(1);

      // Convert price history to our format
      // Use data points that match our configured time window
      const timeWindowHours = Math.ceil(this.adaConfig.flashCrashDetection.timeWindowMinutes / 60);
      const requiredDataPoints = Math.max(timeWindowHours, 2); // At least 2 hours of data

      const entries = historyData.prices
        .slice(-requiredDataPoints * 2) // Get 2x the required data for safety
        .map(([timestamp, price]) => ({
          timestamp: new Date(timestamp),
          price
        }));

      this.priceHistory = entries;
      this.log('info', `Loaded ${entries.length} price history entries for flash detection`);

    } catch (error) {
      this.log('warn', 'Could not load initial price history, will build it over time', error);
    }
  }
}
