import { BasePlugin } from '../base/Plugin';
import { NOAAProvider } from './NOAAProvider';
import { TimezoneHelper } from '../../utils/timezone';
import { NotificationData, ScheduleConfig, PluginConfig, PluginMetadata, TidePrediction } from '../../types';

interface TidePluginConfig {
  station: string;
  location: string;
  timezone: string;
  notifications: {
    highTide: {
      enabled: boolean;
      priority: 'min' | 'low' | 'default' | 'high' | 'max';
    };
    lowTide: {
      enabled: boolean;
    };
    dailySummary: {
      enabled: boolean;
      time: string; // Format: "HH:mm"
    };
  };
}

export class TidePlugin extends BasePlugin {
  private noaaProvider: NOAAProvider;
  private timezoneHelper: TimezoneHelper;
  private lastNotificationTimes: Map<string, Date>;

  constructor(config: PluginConfig) {
    const metadata: PluginMetadata = {
      name: 'tide',
      version: '1.0.0',
      description: 'Provides tide notifications using NOAA data',
      author: 'ntfy-fetch',
      dependencies: ['axios', 'date-fns-tz']
    };

    super(config, metadata);

    this.noaaProvider = new NOAAProvider();
    this.timezoneHelper = new TimezoneHelper();
    this.lastNotificationTimes = new Map();
  }

  getSchedules(): ScheduleConfig[] {
    const schedules: ScheduleConfig[] = [];

    // Check for tide notifications every 5 minutes
    schedules.push({
      expression: '*/5 * * * *',
      description: 'Check for tide notifications',
      enabled: this.enabled
    });

    const pluginConfig = this.getPluginConfig<TidePluginConfig>();

    // Add daily summary schedule if enabled
    if (pluginConfig.notifications.dailySummary.enabled) {
      const [hour, minute] = pluginConfig.notifications.dailySummary.time.split(':');
      schedules.push({
        expression: `${minute} ${hour} * * *`,
        description: 'Send daily tide summary',
        enabled: true
      });
    }

    return schedules;
  }

  async checkConditions(): Promise<NotificationData[]> {
    if (!this.enabled) {
      return [];
    }

    const notifications: NotificationData[] = [];
    const pluginConfig = this.getPluginConfig<TidePluginConfig>();

    try {
      // Check for high tide notifications
      if (pluginConfig.notifications.highTide.enabled) {
        const highTideNotification = await this.checkHighTideNotification();
        if (highTideNotification) {
          notifications.push(highTideNotification);
        }
      }

      // Check for low tide notifications
      if (pluginConfig.notifications.lowTide.enabled) {
        const lowTideNotification = await this.checkLowTideNotification();
        if (lowTideNotification) {
          notifications.push(lowTideNotification);
        }
      }

      // Check for daily summary
      if (pluginConfig.notifications.dailySummary.enabled) {
        const summaryNotification = await this.checkDailySummary();
        if (summaryNotification) {
          notifications.push(summaryNotification);
        }
      }

    } catch (error) {
      this.log('error', 'Failed to check tide conditions', error);
    }

    return notifications;
  }

  protected async onInitialize(): Promise<void> {
    const pluginConfig = this.getPluginConfig<TidePluginConfig>();
    this.log('info', `Initialized with station ${pluginConfig.station} for ${pluginConfig.location}`);

    // Test NOAA API connectivity
    try {
      const nextHighTide = await this.noaaProvider.getNextHighTide();
      if (nextHighTide) {
        this.log('info', `Next high tide: ${this.formatTideTime(nextHighTide)}`);
      } else {
        this.log('warn', 'No upcoming high tide data available');
      }
    } catch (error) {
      this.log('error', 'Failed to connect to NOAA API during initialization', error);
    }
  }

  protected async onCleanup(): Promise<void> {
    this.lastNotificationTimes.clear();
    this.log('info', 'Tide plugin cleanup completed');
  }

  private async checkHighTideNotification(): Promise<NotificationData | null> {
    const pluginConfig = this.getPluginConfig<TidePluginConfig>();
    const { priority } = pluginConfig.notifications.highTide;

    try {
      const nextHighTide = await this.noaaProvider.getNextHighTide();
      if (!nextHighTide) {
        return null;
      }

      const now = new Date();
      const notificationKey = `high-tide-${nextHighTide.time.getTime()}`;

      if (this.lastNotificationTimes.has(notificationKey)) {
        return null; // Already sent notification for this tide
      }

      // Check if it's currently high tide time (within 2 minutes)
      if (this.timezoneHelper.isTideTimeNow(now, nextHighTide.time)) {
        const localTimeStr = this.timezoneHelper.formatLocalTime(nextHighTide.time, 'h:mm a');

        this.lastNotificationTimes.set(notificationKey, now);

        return {
          title: `High Tide Now! 🌊`,
          message: `High tide at ${pluginConfig.location}\nTime: ${localTimeStr}\nHeight: ${nextHighTide.height.toFixed(1)}m`,
          priority: priority || 'default',
          tags: ['tide', 'high-tide', 'ocean']
        };
      }

      return null;

    } catch (error) {
      this.log('error', 'Failed to check high tide notification', error);
      return null;
    }
  }

  private async checkLowTideNotification(): Promise<NotificationData | null> {
    const pluginConfig = this.getPluginConfig<TidePluginConfig>();

    try {
      const nextLowTide = await this.noaaProvider.getNextLowTide();
      if (!nextLowTide) {
        return null;
      }

      const now = new Date();
      const notificationKey = `low-tide-${nextLowTide.time.getTime()}`;

      if (this.lastNotificationTimes.has(notificationKey)) {
        return null;
      }

      // Check if it's currently low tide time (within 2 minutes)
      if (this.timezoneHelper.isTideTimeNow(now, nextLowTide.time)) {
        const localTimeStr = this.timezoneHelper.formatLocalTime(nextLowTide.time, 'h:mm a');

        this.lastNotificationTimes.set(notificationKey, now);

        return {
          title: `Low Tide Now! 🏖️`,
          message: `Low tide at ${pluginConfig.location}\nTime: ${localTimeStr}\nHeight: ${nextLowTide.height.toFixed(1)}m`,
          priority: 'low',
          tags: ['tide', 'low-tide', 'ocean']
        };
      }

      return null;

    } catch (error) {
      this.log('error', 'Failed to check low tide notification', error);
      return null;
    }
  }

  private async checkDailySummary(): Promise<NotificationData | null> {
    const pluginConfig = this.getPluginConfig<TidePluginConfig>();
    const now = new Date();
    const today = now.toDateString();
    const notificationKey = `daily-summary-${today}`;

    if (this.lastNotificationTimes.has(notificationKey)) {
      return null; // Already sent today's summary
    }

    try {
      const todaysTides = await this.noaaProvider.getTodaysTides();
      if (todaysTides.length === 0) {
        return null;
      }

      const highTides = todaysTides.filter(t => t.type === 'H');
      const lowTides = todaysTides.filter(t => t.type === 'L');

      let message = `🌊 Daily Tide Summary for ${pluginConfig.location}\n\n`;

      // Show combined timeline of all tides
      const allTides = todaysTides.sort((a, b) => a.time.getTime() - b.time.getTime());

      if (allTides.length > 0) {
        message += `📅 ${this.timezoneHelper.formatLocalTime(allTides[0].time, 'EEEE, MMM dd')}\n\n`;

        allTides.forEach(tide => {
          const time = this.timezoneHelper.formatLocalTime(tide.time, 'h:mm a');
          const icon = tide.type === 'H' ? '🌊' : '🏖️';
          const type = tide.type === 'H' ? 'High' : 'Low';
          message += `${icon} ${time} - ${type} Tide (${tide.height.toFixed(1)}m)\n`;
        });

        // Add summary
        const nextTide = allTides.find(tide => tide.time > new Date());
        if (nextTide) {
          const timeUntil = this.timezoneHelper.getTimeUntilTide(nextTide.time);
          const duration = this.timezoneHelper.formatDuration(timeUntil.hours, timeUntil.minutes);
          const nextTime = this.timezoneHelper.formatLocalTime(nextTide.time, 'h:mm a');
          const nextType = nextTide.type === 'H' ? 'High' : 'Low';
          message += `\n⏰ Next: ${nextType} tide at ${nextTime} (in ${duration})`;
        }
      }

      this.lastNotificationTimes.set(notificationKey, now);

      return {
        title: '📊 Daily Tide Summary',
        message: message.trim(),
        priority: 'low',
        tags: ['tide', 'summary', 'daily']
      };

    } catch (error) {
      this.log('error', 'Failed to generate daily tide summary', error);
      return null;
    }
  }

  private formatTideTime(tide: TidePrediction): string {
    const localTime = this.timezoneHelper.formatLocalTime(tide.time, 'MMM dd, h:mm a');
    return `${localTime} (${tide.height.toFixed(1)}m ${tide.type === 'H' ? 'High' : 'Low'})`;
  }
}