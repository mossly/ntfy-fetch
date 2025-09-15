import { logger } from './logger';

/**
 * Manages notification history to prevent duplicate sends
 */
export class NotificationTracker {
  private sentNotifications: Map<string, Date>;
  private cleanupIntervalMs: number;

  constructor(cleanupIntervalHours: number = 24) {
    this.sentNotifications = new Map();
    this.cleanupIntervalMs = cleanupIntervalHours * 60 * 60 * 1000;
  }

  /**
   * Check if a notification has already been sent
   */
  hasBeenSent(key: string): boolean {
    return this.sentNotifications.has(key);
  }

  /**
   * Mark a notification as sent
   */
  markAsSent(key: string): void {
    this.sentNotifications.set(key, new Date());
    logger.debug(`Marked notification as sent: ${key}`);
  }

  /**
   * Clean up old notification records
   */
  cleanup(now: Date = new Date()): number {
    const cutoffTime = new Date(now.getTime() - this.cleanupIntervalMs);
    let removedCount = 0;

    for (const [key, sentTime] of this.sentNotifications.entries()) {
      if (sentTime < cutoffTime) {
        this.sentNotifications.delete(key);
        removedCount++;
        logger.debug(`Cleaned up old notification key: ${key}`);
      }
    }

    return removedCount;
  }

  /**
   * Clear all tracked notifications
   */
  clear(): void {
    this.sentNotifications.clear();
  }

  /**
   * Get the number of tracked notifications
   */
  size(): number {
    return this.sentNotifications.size;
  }
}

/**
 * Handles time-based scheduling logic
 */
export class ScheduleChecker {
  /**
   * Check if current time is within a window of the target time
   * @param targetTime The target time to check against
   * @param windowMinutes The window size in minutes (default: 5)
   * @param now Optional current time (for testing)
   */
  static isWithinTimeWindow(
    targetTime: { hour: number; minute: number },
    windowMinutes: number = 5,
    now: Date = new Date()
  ): boolean {
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    const currentTotalMinutes = currentHour * 60 + currentMinute;
    const targetTotalMinutes = targetTime.hour * 60 + targetTime.minute;

    // Handle day boundary (e.g., 23:59 -> 00:01)
    const diff = Math.abs(currentTotalMinutes - targetTotalMinutes);
    const diffAcrossMidnight = Math.abs(1440 - diff); // 1440 = 24 * 60

    return Math.min(diff, diffAcrossMidnight) <= windowMinutes;
  }

  /**
   * Parse a time string into hours and minutes
   * @param timeStr Time string in HH:mm format
   */
  static parseTimeString(timeStr: string): { hour: number; minute: number } {
    const [hour, minute] = timeStr.split(':').map(Number);

    if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new Error(`Invalid time string: ${timeStr}. Expected format: HH:mm`);
    }

    return { hour, minute };
  }

  /**
   * Check if it's time for a daily notification
   * @param scheduleTime Time in HH:mm format
   * @param lastSentKey Key to track if already sent today
   * @param tracker NotificationTracker instance
   * @param windowMinutes Time window in minutes
   */
  static isDailyNotificationTime(
    scheduleTime: string,
    lastSentKey: string,
    tracker: NotificationTracker,
    windowMinutes: number = 5
  ): boolean {
    // Check if already sent
    if (tracker.hasBeenSent(lastSentKey)) {
      return false;
    }

    // Parse scheduled time
    const targetTime = this.parseTimeString(scheduleTime);

    // Check if within time window
    return this.isWithinTimeWindow(targetTime, windowMinutes);
  }

  /**
   * Generate a daily key for tracking (resets each day)
   * @param prefix Prefix for the key
   * @param date Date to generate key for
   */
  static getDailyKey(prefix: string, date: Date = new Date()): string {
    return `${prefix}-${date.toISOString().split('T')[0]}`;
  }

  /**
   * Calculate minutes until a target time
   * @param targetTime Target time as Date object
   * @param now Current time
   */
  static minutesUntil(targetTime: Date, now: Date = new Date()): number {
    const diff = targetTime.getTime() - now.getTime();
    return Math.floor(diff / 60000);
  }

  /**
   * Check if a recurring event should trigger
   * @param eventTime Time of the event
   * @param windowMinutes Window in minutes to consider "now"
   * @param now Current time
   */
  static isEventTime(
    eventTime: Date,
    windowMinutes: number = 2,
    now: Date = new Date()
  ): boolean {
    const minutesUntil = this.minutesUntil(eventTime, now);
    return Math.abs(minutesUntil) <= windowMinutes;
  }
}

/**
 * Configuration for scheduled notifications
 */
export interface ScheduledNotificationConfig {
  enabled: boolean;
  time?: string; // HH:mm format for daily notifications
  windowMinutes?: number; // Time window for triggering
  priority?: 'min' | 'low' | 'default' | 'high' | 'max';
}

/**
 * Helper class for managing different types of scheduled notifications
 */
export class NotificationScheduler {
  private tracker: NotificationTracker;
  private pluginName: string;

  constructor(pluginName: string, cleanupIntervalHours: number = 24) {
    this.pluginName = pluginName;
    this.tracker = new NotificationTracker(cleanupIntervalHours);
  }

  /**
   * Check if a daily summary should be sent
   */
  shouldSendDailySummary(config: ScheduledNotificationConfig): boolean {
    if (!config.enabled || !config.time) {
      return false;
    }

    const dailyKey = ScheduleChecker.getDailyKey(`${this.pluginName}-daily-summary`);
    return ScheduleChecker.isDailyNotificationTime(
      config.time,
      dailyKey,
      this.tracker,
      config.windowMinutes || 5
    );
  }

  /**
   * Mark daily summary as sent
   */
  markDailySummaryAsSent(): void {
    const dailyKey = ScheduleChecker.getDailyKey(`${this.pluginName}-daily-summary`);
    this.tracker.markAsSent(dailyKey);
  }

  /**
   * Check if an event notification should be sent
   */
  shouldSendEventNotification(
    eventId: string,
    eventTime: Date,
    windowMinutes: number = 2
  ): boolean {
    const eventKey = `${this.pluginName}-event-${eventId}`;

    if (this.tracker.hasBeenSent(eventKey)) {
      return false;
    }

    if (ScheduleChecker.isEventTime(eventTime, windowMinutes)) {
      this.tracker.markAsSent(eventKey);
      return true;
    }

    return false;
  }

  /**
   * Clean up old notification records
   */
  cleanup(): void {
    this.tracker.cleanup();
  }

  /**
   * Get the notification tracker (for advanced use cases)
   */
  getTracker(): NotificationTracker {
    return this.tracker;
  }
}

/**
 * Create cron expressions for common schedules
 */
export class CronExpressionBuilder {
  /**
   * Create a cron expression for a daily schedule at a specific time
   * @param time Time in HH:mm format
   */
  static daily(time: string): string {
    const { hour, minute } = ScheduleChecker.parseTimeString(time);
    return `${minute} ${hour} * * *`;
  }

  /**
   * Create a cron expression for every N minutes
   * @param minutes Interval in minutes
   */
  static everyMinutes(minutes: number): string {
    if (minutes < 1 || minutes > 59) {
      throw new Error('Minutes must be between 1 and 59');
    }
    return `*/${minutes} * * * *`;
  }

  /**
   * Create a cron expression for every N hours
   * @param hours Interval in hours
   */
  static everyHours(hours: number): string {
    if (hours < 1 || hours > 23) {
      throw new Error('Hours must be between 1 and 23');
    }
    return `0 */${hours} * * *`;
  }

  /**
   * Create a cron expression for specific days of the week
   * @param time Time in HH:mm format
   * @param days Array of day numbers (0=Sunday, 6=Saturday)
   */
  static weekly(time: string, days: number[]): string {
    const { hour, minute } = ScheduleChecker.parseTimeString(time);
    const dayList = days.join(',');
    return `${minute} ${hour} * * ${dayList}`;
  }

  /**
   * Create a cron expression for the first day of each month
   * @param time Time in HH:mm format
   */
  static monthly(time: string): string {
    const { hour, minute } = ScheduleChecker.parseTimeString(time);
    return `${minute} ${hour} 1 * *`;
  }
}