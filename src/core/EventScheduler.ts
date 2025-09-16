import { NotificationService } from './NotificationService';
import { ScheduledEvent, EventSchedulerOptions, IEventQueue } from '../types/events';
import { logger } from '../utils/logger';

interface ScheduledTimer {
  eventId: string;
  timer: NodeJS.Timeout;
  scheduledFor: Date;
}

export class EventScheduler {
  private eventQueue: IEventQueue;
  private notificationService: NotificationService;
  private scheduledTimers: Map<string, ScheduledTimer>;
  private checkIntervalMs: number;
  private scheduleHorizonHours: number;
  private gracefulShutdownTimeoutMs: number;
  private fallbackCheckInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;

  constructor(
    notificationService: NotificationService,
    options: EventSchedulerOptions
  ) {
    this.eventQueue = options.eventQueue;
    this.notificationService = notificationService;
    this.scheduledTimers = new Map();
    this.checkIntervalMs = options.checkIntervalMs || 60000; // 1 minute default
    this.scheduleHorizonHours = options.scheduleHorizonHours || 6; // Schedule 6 hours ahead
    this.gracefulShutdownTimeoutMs = options.gracefulShutdownTimeoutMs || 5000;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('EventScheduler is already running');
      return;
    }

    logger.info('Starting EventScheduler');
    this.isRunning = true;
    this.isShuttingDown = false;

    // Schedule existing pending events
    await this.scheduleExistingEvents();

    // Start fallback check interval
    this.startFallbackCheck();

    // Handle process signals for graceful shutdown
    this.setupSignalHandlers();

    logger.info(`EventScheduler started with ${this.scheduledTimers.size} scheduled events`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping EventScheduler');
    this.isRunning = false;
    this.isShuttingDown = true;

    // Stop fallback check
    if (this.fallbackCheckInterval) {
      clearInterval(this.fallbackCheckInterval);
      this.fallbackCheckInterval = null;
    }

    // Clear all scheduled timers
    for (const [eventId, scheduledTimer] of this.scheduledTimers) {
      clearTimeout(scheduledTimer.timer);
      // Mark events as pending again so they're picked up on restart
      await this.eventQueue.update(eventId, { status: 'pending' });
    }
    this.scheduledTimers.clear();

    // Save queue state
    await this.eventQueue.shutdown();

    logger.info('EventScheduler stopped');
  }

  private async scheduleExistingEvents(): Promise<void> {
    const horizonDate = new Date(Date.now() + this.scheduleHorizonHours * 60 * 60 * 1000);

    const pendingEvents = await this.eventQueue.query({
      status: 'pending',
      beforeDate: horizonDate
    });

    logger.info(`Found ${pendingEvents.length} pending events to schedule`);

    for (const event of pendingEvents) {
      await this.scheduleEvent(event);
    }
  }

  private async scheduleEvent(event: ScheduledEvent): Promise<void> {
    // Skip if already scheduled
    if (this.scheduledTimers.has(event.id)) {
      return;
    }

    const now = Date.now();
    const scheduledTime = event.scheduledFor instanceof Date
      ? event.scheduledFor
      : new Date(event.scheduledFor);

    const delayMs = scheduledTime.getTime() - now;

    // If event is overdue, send immediately
    if (delayMs <= 0) {
      logger.warn(`Event ${event.id} is overdue by ${Math.abs(delayMs)}ms, sending immediately`);
      await this.sendNotification(event);
      return;
    }

    // If event is too far in the future, skip (will be picked up later)
    if (delayMs > this.scheduleHorizonHours * 60 * 60 * 1000) {
      logger.debug(`Event ${event.id} is too far in the future (${delayMs}ms), skipping for now`);
      return;
    }

    // Schedule the event
    const timer = setTimeout(async () => {
      this.scheduledTimers.delete(event.id);
      await this.sendNotification(event);
    }, delayMs);

    this.scheduledTimers.set(event.id, {
      eventId: event.id,
      timer,
      scheduledFor: scheduledTime
    });

    await this.eventQueue.markAsScheduled(event.id);

    logger.debug(`Scheduled event ${event.id} for ${scheduledTime} (in ${delayMs}ms)`);
  }

  private async sendNotification(event: ScheduledEvent): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn(`Skipping notification for ${event.id} due to shutdown`);
      return;
    }

    try {
      logger.info(`Sending notification for event ${event.id}`);

      const success = await this.notificationService.sendNotification({
        title: event.payload.title,
        message: event.payload.message,
        priority: event.payload.priority,
        tags: event.payload.tags
      });

      if (success) {
        await this.eventQueue.markAsSent(event.id);
        logger.info(`Successfully sent notification for event ${event.id}`);
      } else {
        throw new Error('Notification service returned failure');
      }
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      logger.error(`Failed to send notification for event ${event.id}:`, error);
      await this.eventQueue.markAsFailed(event.id, errorMessage);

      // If it was rescheduled for retry, schedule it again
      const updatedEvent = await this.eventQueue.get(event.id);
      if (updatedEvent && updatedEvent.status === 'pending') {
        await this.scheduleEvent(updatedEvent);
      }
    }
  }

  private startFallbackCheck(): void {
    this.fallbackCheckInterval = setInterval(async () => {
      if (!this.isRunning || this.isShuttingDown) {
        return;
      }

      try {
        await this.checkForMissedEvents();
        await this.scheduleUpcomingEvents();
      } catch (error) {
        logger.error('Error in fallback check:', error);
      }
    }, this.checkIntervalMs);

    logger.info(`Started fallback check with ${this.checkIntervalMs}ms interval`);
  }

  private async checkForMissedEvents(): Promise<void> {
    // Check for any events that should have been sent but weren't
    const overdueEvents = await this.eventQueue.query({
      status: ['pending', 'scheduled'],
      beforeDate: new Date()
    });

    if (overdueEvents.length > 0) {
      logger.warn(`Found ${overdueEvents.length} overdue events`);

      for (const event of overdueEvents) {
        if (!this.scheduledTimers.has(event.id)) {
          await this.sendNotification(event);
        }
      }
    }
  }

  private async scheduleUpcomingEvents(): Promise<void> {
    // Schedule any new events that have come into our scheduling horizon
    const horizonDate = new Date(Date.now() + this.scheduleHorizonHours * 60 * 60 * 1000);

    const upcomingEvents = await this.eventQueue.query({
      status: 'pending',
      beforeDate: horizonDate
    });

    for (const event of upcomingEvents) {
      if (!this.scheduledTimers.has(event.id)) {
        await this.scheduleEvent(event);
      }
    }
  }

  private setupSignalHandlers(): void {
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown`);

      const shutdownTimeout = setTimeout(() => {
        logger.error('Graceful shutdown timed out, forcing exit');
        process.exit(1);
      }, this.gracefulShutdownTimeoutMs);

      try {
        await this.stop();
        clearTimeout(shutdownTimeout);
        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        clearTimeout(shutdownTimeout);
        process.exit(1);
      }
    };

    process.once('SIGINT', () => gracefulShutdown('SIGINT'));
    process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  }

  async addEvent(event: Omit<ScheduledEvent, 'createdAt' | 'updatedAt' | 'retryCount'>): Promise<ScheduledEvent> {
    const addedEvent = await this.eventQueue.add(event);

    // Schedule immediately if within horizon
    const horizonDate = new Date(Date.now() + this.scheduleHorizonHours * 60 * 60 * 1000);
    const scheduledFor = addedEvent.scheduledFor instanceof Date
      ? addedEvent.scheduledFor
      : new Date(addedEvent.scheduledFor);

    if (scheduledFor <= horizonDate && this.isRunning) {
      await this.scheduleEvent(addedEvent);
    }

    return addedEvent;
  }

  async addEvents(events: Omit<ScheduledEvent, 'createdAt' | 'updatedAt' | 'retryCount'>[]): Promise<ScheduledEvent[]> {
    const addedEvents = await this.eventQueue.addBatch(events);

    // Schedule those within horizon
    const horizonDate = new Date(Date.now() + this.scheduleHorizonHours * 60 * 60 * 1000);

    for (const event of addedEvents) {
      const scheduledFor = event.scheduledFor instanceof Date
        ? event.scheduledFor
        : new Date(event.scheduledFor);

      if (scheduledFor <= horizonDate && this.isRunning) {
        await this.scheduleEvent(event);
      }
    }

    return addedEvents;
  }

  async cancelEvent(eventId: string): Promise<boolean> {
    // Clear timer if scheduled
    const scheduledTimer = this.scheduledTimers.get(eventId);
    if (scheduledTimer) {
      clearTimeout(scheduledTimer.timer);
      this.scheduledTimers.delete(eventId);
    }

    // Remove from queue
    return await this.eventQueue.remove(eventId);
  }

  async getStats(): Promise<{
    scheduledInMemory: number;
    queueStats: Awaited<ReturnType<IEventQueue['getStats']>>;
  }> {
    const queueStats = await this.eventQueue.getStats();

    return {
      scheduledInMemory: this.scheduledTimers.size,
      queueStats
    };
  }

  getScheduledEvents(): Array<{
    eventId: string;
    scheduledFor: Date;
    timeUntil: number;
  }> {
    const now = Date.now();
    return Array.from(this.scheduledTimers.values()).map(timer => ({
      eventId: timer.eventId,
      scheduledFor: timer.scheduledFor,
      timeUntil: timer.scheduledFor.getTime() - now
    }));
  }
}