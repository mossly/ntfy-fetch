import { BasePlugin } from '../base/Plugin';
import { NOAAProvider } from './NOAAProvider';
import { TimezoneHelper } from '../../utils/timezone';
import { CronExpressionBuilder } from '../../utils/scheduling';
import { NotificationData, ScheduleConfig, PluginConfig, PluginMetadata, TidePrediction } from '../../types';
import { ScheduledEvent } from '../../types/events';
import { EventScheduler } from '../../core/EventScheduler';

interface TidePluginConfigV2 {
  station: string;
  location: string;
  timezone: string;
  notifications: {
    highTide: {
      enabled: boolean;
      priority: 'min' | 'low' | 'default' | 'high' | 'max';
      advanceNotice: number[]; // Minutes before the tide (e.g., [2, 10, 30])
      exactTime: boolean; // Send notification at exact tide time
    };
    lowTide: {
      enabled: boolean;
      priority?: 'min' | 'low' | 'default' | 'high' | 'max';
      advanceNotice: number[];
      exactTime: boolean;
    };
    dailySummary: {
      enabled: boolean;
      time: string; // Format: "HH:mm"
    };
  };
  scheduling: {
    refreshIntervalHours: number; // How often to refresh tide data and schedule events
    scheduleAheadHours: number; // How far ahead to schedule events
  };
}

export class TidePluginV2 extends BasePlugin {
  private noaaProvider: NOAAProvider;
  private timezoneHelper: TimezoneHelper;
  private eventScheduler: EventScheduler | null = null;
  private lastScheduledDate: Date | null = null;
  private scheduledEventIds: Set<string> = new Set();

  constructor(config: PluginConfig) {
    const metadata: PluginMetadata = {
      name: 'tide',
      version: '2.0.0',
      description: 'Provides precise tide notifications using event scheduling',
      author: 'ntfy-fetch',
      dependencies: ['axios', 'date-fns-tz']
    };

    super(config, metadata);

    this.noaaProvider = new NOAAProvider();
    this.timezoneHelper = new TimezoneHelper();
  }

  async setEventScheduler(scheduler: EventScheduler): Promise<void> {
    this.eventScheduler = scheduler;
    this.log('info', 'Event scheduler connected');
    // Schedule initial events when scheduler is set
    await this.onEventSchedulerConnected();
  }

  getSchedules(): ScheduleConfig[] {
    const schedules: ScheduleConfig[] = [];
    const pluginConfig = this.getPluginConfig<TidePluginConfigV2>();

    // Schedule tide event planning
    const refreshHours = pluginConfig.scheduling?.refreshIntervalHours || 6;
    schedules.push({
      expression: CronExpressionBuilder.everyHours(refreshHours),
      description: 'Schedule tide notification events',
      enabled: this.enabled
    });

    // Daily summary still uses traditional scheduling
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
    const pluginConfig = this.getPluginConfig<TidePluginConfigV2>();
    const scheduleDescription = context?.description || 'manual';

    this.log('debug', `Checking conditions for schedule: ${scheduleDescription}`);

    try {
      if (scheduleDescription.includes('daily tide summary')) {
        const summaryNotification = await this.generateDailySummary();
        if (summaryNotification) {
          notifications.push(summaryNotification);
        }
      } else if (scheduleDescription.includes('Schedule tide notification events')) {
        // Schedule events for upcoming tides
        await this.scheduleTideEvents();
        // Don't return any immediate notifications - they're scheduled for later
      }
    } catch (error) {
      this.log('error', 'Failed to check tide conditions', error);
    }

    return notifications;
  }

  private async scheduleTideEvents(): Promise<void> {
    if (!this.eventScheduler) {
      this.log('error', 'Event scheduler not available, cannot schedule tide events');
      return;
    }

    const pluginConfig = this.getPluginConfig<TidePluginConfigV2>();
    const scheduleAheadHours = pluginConfig.scheduling?.scheduleAheadHours || 24;

    this.log('info', `Scheduling tide events for next ${scheduleAheadHours} hours`);

    try {
      // Cancel any previously scheduled events that haven't fired yet
      await this.cancelPreviouslyScheduledEvents();

      const now = new Date();
      const endTime = new Date(now.getTime() + scheduleAheadHours * 60 * 60 * 1000);

      // Get tide predictions for the period
      const tides = await this.noaaProvider.getTidesForPeriod(now, endTime);

      if (tides.length === 0) {
        this.log('warn', 'No tide data available for scheduling period');
        return;
      }

      const events: Omit<ScheduledEvent, 'createdAt' | 'updatedAt' | 'retryCount'>[] = [];

      for (const tide of tides) {
        if (tide.type === 'H' && pluginConfig.notifications.highTide.enabled) {
          events.push(...this.createTideEvents(tide, pluginConfig.notifications.highTide, 'high'));
        } else if (tide.type === 'L' && pluginConfig.notifications.lowTide.enabled) {
          events.push(...this.createTideEvents(tide, pluginConfig.notifications.lowTide, 'low'));
        }
      }

      if (events.length > 0) {
        const scheduledEvents = await this.eventScheduler.addEvents(events);

        // Track scheduled event IDs for future cancellation
        for (const event of scheduledEvents) {
          this.scheduledEventIds.add(event.id);
        }

        this.log('info', `Scheduled ${events.length} tide notification events`);
      } else {
        this.log('info', 'No tide events to schedule for this period');
      }

      this.lastScheduledDate = now;

    } catch (error) {
      this.log('error', 'Failed to schedule tide events', error);
    }
  }

  private createTideEvents(
    tide: TidePrediction,
    config: TidePluginConfigV2['notifications']['highTide'] | TidePluginConfigV2['notifications']['lowTide'],
    tideType: 'high' | 'low'
  ): Omit<ScheduledEvent, 'createdAt' | 'updatedAt' | 'retryCount'>[] {
    const events: Omit<ScheduledEvent, 'createdAt' | 'updatedAt' | 'retryCount'>[] = [];
    const pluginConfig = this.getPluginConfig<TidePluginConfigV2>();

    const title = tideType === 'high' ? 'High Tide' : 'Low Tide';
    const priority = config.priority || (tideType === 'high' ? 'default' : 'low');

    // Create advance notice events
    for (const minutesBefore of config.advanceNotice || []) {
      const notificationTime = new Date(tide.time.getTime() - minutesBefore * 60 * 1000);

      // Skip if notification time has already passed
      if (notificationTime < new Date()) {
        continue;
      }

      const eventId = `${this.name}-${tideType}-${tide.time.getTime()}-${minutesBefore}min`;
      const localTimeStr = this.timezoneHelper.formatLocalTime(tide.time, 'h:mm a');

      const minutesText = minutesBefore === 1 ? '1 minute' : `${minutesBefore} minutes`;

      events.push({
        id: eventId,
        pluginName: this.name,
        eventType: `${tideType}-tide-advance`,
        scheduledFor: notificationTime,
        status: 'pending',
        maxRetries: 3,
        payload: {
          title: `${title} in ${minutesText}`,
          message: `${title} at ${pluginConfig.location}\nTime: ${localTimeStr}\nHeight: ${tide.height.toFixed(1)}m`,
          priority,
          tags: ['tide', `${tideType}-tide`, 'advance-notice']
        },
        metadata: {
          originalEventTime: tide.time,
          advanceMinutes: minutesBefore,
          tideType,
          tideHeight: tide.height
        }
      });
    }

    // Create exact time event
    if (config.exactTime) {
      // Skip if tide time has already passed
      if (tide.time >= new Date()) {
        const eventId = `${this.name}-${tideType}-${tide.time.getTime()}-exact`;
        const localTimeStr = this.timezoneHelper.formatLocalTime(tide.time, 'h:mm a');

        events.push({
          id: eventId,
          pluginName: this.name,
          eventType: `${tideType}-tide-exact`,
          scheduledFor: tide.time,
          status: 'pending',
          maxRetries: 3,
          payload: {
            title: `${title} Now!`,
            message: `${title} at ${pluginConfig.location}\nTime: ${localTimeStr}\nHeight: ${tide.height.toFixed(1)}m`,
            priority,
            tags: ['tide', `${tideType}-tide`, 'exact-time']
          },
          metadata: {
            originalEventTime: tide.time,
            advanceMinutes: 0,
            tideType,
            tideHeight: tide.height
          }
        });
      }
    }

    return events;
  }

  private async cancelPreviouslyScheduledEvents(): Promise<void> {
    if (!this.eventScheduler) {
      return;
    }

    let cancelCount = 0;
    for (const eventId of this.scheduledEventIds) {
      const cancelled = await this.eventScheduler.cancelEvent(eventId);
      if (cancelled) {
        cancelCount++;
      }
    }

    if (cancelCount > 0) {
      this.log('info', `Cancelled ${cancelCount} previously scheduled events`);
    }

    this.scheduledEventIds.clear();
  }

  private async generateDailySummary(): Promise<NotificationData | null> {
    const pluginConfig = this.getPluginConfig<TidePluginConfigV2>();

    try {
      const todaysTides = await this.noaaProvider.getTodaysTides();
      if (todaysTides.length === 0) {
        return null;
      }

      const highTides = todaysTides.filter(t => t.type === 'H');
      const lowTides = todaysTides.filter(t => t.type === 'L');

      let message = `Daily Tide Summary for ${pluginConfig.location}\n\n`;

      const allTides = todaysTides.sort((a, b) => a.time.getTime() - b.time.getTime());

      if (allTides.length > 0) {
        message += `${this.timezoneHelper.formatLocalTime(allTides[0].time, 'EEEE, MMM dd')}\n\n`;

        allTides.forEach(tide => {
          const time = this.timezoneHelper.formatLocalTime(tide.time, 'h:mm a');
          const type = tide.type === 'H' ? 'High' : 'Low';
          message += `${time} - ${type} Tide (${tide.height.toFixed(1)}m)\n`;
        });

        const nextTide = allTides.find(tide => tide.time > new Date());
        if (nextTide) {
          const timeUntil = this.timezoneHelper.getTimeUntilTide(nextTide.time);
          const duration = this.timezoneHelper.formatDuration(timeUntil.hours, timeUntil.minutes);
          const nextTime = this.timezoneHelper.formatLocalTime(nextTide.time, 'h:mm a');
          const nextType = nextTide.type === 'H' ? 'High' : 'Low';
          message += `\nNext: ${nextType} tide at ${nextTime} (in ${duration})`;
        }
      }

      return {
        title: 'Daily Tide Summary',
        message: message.trim(),
        priority: 'low',
        tags: ['tide', 'summary', 'daily']
      };

    } catch (error) {
      this.log('error', 'Failed to generate daily tide summary', error);
      return null;
    }
  }

  protected async onInitialize(): Promise<void> {
    const pluginConfig = this.getPluginConfig<TidePluginConfigV2>();
    this.log('info', `Initialized Tide Plugin V2 with station ${pluginConfig.station} for ${pluginConfig.location}`);

    // Test NOAA API connectivity
    try {
      const nextHighTide = await this.noaaProvider.getNextHighTide();
      if (nextHighTide) {
        const localTime = this.timezoneHelper.formatLocalTime(nextHighTide.time, 'MMM dd, h:mm a');
        this.log('info', `Next high tide: ${localTime} (${nextHighTide.height.toFixed(1)}m)`);
      } else {
        this.log('warn', 'No upcoming high tide data available');
      }
    } catch (error) {
      this.log('error', 'Failed to connect to NOAA API during initialization', error);
    }

    // Schedule initial tide events if event scheduler is available
    // This will be called again after event scheduler is connected
    if (this.eventScheduler) {
      await this.scheduleTideEvents();
    }
  }

  async onEventSchedulerConnected(): Promise<void> {
    // Schedule initial tide events when event scheduler becomes available
    this.log('info', 'Event scheduler connected, scheduling initial tide events');
    await this.scheduleTideEvents();
  }

  protected async onCleanup(): Promise<void> {
    await this.cancelPreviouslyScheduledEvents();
    this.log('info', 'Tide plugin V2 cleanup completed');
  }
}