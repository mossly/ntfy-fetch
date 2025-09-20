import { BasePlugin } from '../base/Plugin';
import { NOAAProvider } from './NOAAProvider';
import { TimezoneHelper } from '../../utils/timezone';
import { NotificationScheduler, ScheduleChecker, CronExpressionBuilder } from '../../utils/scheduling';
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
  private scheduler: NotificationScheduler;
  private lastCheckTime: Date | null = null;

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
    this.scheduler = new NotificationScheduler('tide', 24);
  }

  getSchedules(): ScheduleConfig[] {
    const schedules: ScheduleConfig[] = [];
    const pluginConfig = this.getPluginConfig<TidePluginConfig>();

    // Check for tide notifications every 5 minutes
    schedules.push({
      expression: CronExpressionBuilder.everyMinutes(5),
      description: 'Check for tide notifications',
      enabled: this.enabled
    });

    // Add daily summary schedule if enabled
    if (pluginConfig.notifications.dailySummary.enabled) {
      schedules.push({
        expression: CronExpressionBuilder.daily(pluginConfig.notifications.dailySummary.time),
        description: 'Send daily tide summary',
        enabled: true
      });
    }

    return schedules;
  }

  async checkConditions(context?: { description?: string }): Promise<NotificationData[]> {
    if (!this.enabled) {
      return [];
    }

    const notifications: NotificationData[] = [];
    const pluginConfig = this.getPluginConfig<TidePluginConfig>();
    const now = new Date();

    // Clean up old notification records periodically
    this.scheduler.cleanup();

    // Determine which schedule triggered this check
    const scheduleDescription = context?.description || 'manual';
    this.log('debug', `Checking conditions for schedule: ${scheduleDescription}`);

    try {
      // Check based on which schedule triggered this
      if (scheduleDescription.includes('daily tide summary')) {
        // This is the 7 AM daily summary schedule
        if (pluginConfig.notifications.dailySummary.enabled) {
          const summaryNotification = await this.checkDailySummary();
          if (summaryNotification) {
            notifications.push(summaryNotification);
          }
        }
      } else {
        // This is the regular 5-minute tide check
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
    this.scheduler.cleanup();
    this.log('info', 'Tide plugin cleanup completed');
  }

  private async checkHighTideNotification(): Promise<NotificationData | null> {
    const pluginConfig = this.getPluginConfig<TidePluginConfig>();
    const { priority } = pluginConfig.notifications.highTide;

    try {
      const nextHighTide = await this.noaaProvider.getNextHighTide();
      if (!nextHighTide) {
        this.log('debug', 'No upcoming high tide found');
        return null;
      }

      const now = new Date();
      const eventId = `high-${nextHighTide.time.getTime()}`;

      const minutesUntil = ScheduleChecker.minutesUntil(nextHighTide.time, now);
      this.log('debug', `Next high tide in ${minutesUntil} minutes: ${this.formatTideTime(nextHighTide)}`);

      // Check if it's time to send the notification
      if (this.scheduler.shouldSendEventNotification(eventId, nextHighTide.time, 2)) {
        return {
          title: 'High Tide',
          message: ' ',
          priority: priority || 'default'
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
        this.log('debug', 'No upcoming low tide found');
        return null;
      }

      const now = new Date();
      const eventId = `low-${nextLowTide.time.getTime()}`;

      const minutesUntil = ScheduleChecker.minutesUntil(nextLowTide.time, now);
      this.log('debug', `Next low tide in ${minutesUntil} minutes: ${this.formatTideTime(nextLowTide)}`);

      // Check if it's time to send the notification
      if (this.scheduler.shouldSendEventNotification(eventId, nextLowTide.time, 2)) {
        return {
          title: 'Low Tide',
          message: ' ',
          priority: 'low'
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

    // Check if it's time to send the daily summary
    if (!this.scheduler.shouldSendDailySummary({
      enabled: pluginConfig.notifications.dailySummary.enabled,
      time: pluginConfig.notifications.dailySummary.time,
      windowMinutes: 5
    })) {
      return null;
    }

    try {
      const todaysTides = await this.noaaProvider.getTodaysTides();
      if (todaysTides.length === 0) {
        return null;
      }

      const highTides = todaysTides.filter(t => t.type === 'H');
      const lowTides = todaysTides.filter(t => t.type === 'L');

      const allTides = todaysTides.sort((a, b) => a.time.getTime() - b.time.getTime());

      const futureTides = allTides.filter(tide => tide.time > new Date());
      if (futureTides.length === 0) {
        return null;
      }

      const message = futureTides.map(tide => {
        const time = this.timezoneHelper.formatLocalTime(tide.time, 'h:mm a');
        const type = tide.type === 'H' ? 'High' : 'Low';
        return `${time} - ${type} Tide`;
      }).join('\n');

      this.scheduler.markDailySummaryAsSent();

      return {
        title: "Daily Tides",
        message,
        priority: 'low'
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



