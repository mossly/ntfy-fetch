import * as fs from 'fs/promises';
import * as path from 'path';
import { ScheduledEvent, EventQueueOptions, EventFilter, IEventQueue } from '../types/events';
import { logger } from '../utils/logger';

export class EventQueue implements IEventQueue {
  private persistencePath: string;
  private events: Map<string, ScheduledEvent>;
  private cleanupIntervalHours: number;
  private retentionHours: number;
  private maxRetries: number;
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private isDirty: boolean = false;

  constructor(options: EventQueueOptions = {}) {
    this.persistencePath = options.persistencePath || path.join(process.cwd(), 'data', 'scheduled-events.json');
    this.cleanupIntervalHours = options.cleanupIntervalHours || 24;
    this.retentionHours = options.retentionHours || 48;
    this.maxRetries = options.maxRetries || 3;
    this.events = new Map();

    this.loadEvents();
    this.startCleanupInterval();
  }

  private async loadEvents(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.persistencePath), { recursive: true });

      const data = await fs.readFile(this.persistencePath, 'utf-8');
      const events: ScheduledEvent[] = JSON.parse(data, (key, value) => {
        // Re-hydrate Date objects
        if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
          return new Date(value);
        }
        return value;
      });

      for (const event of events) {
        this.events.set(event.id, event);
      }

      logger.info(`Loaded ${this.events.size} scheduled events from persistence`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.info('No existing scheduled events file found, starting fresh');
      } else {
        logger.error('Failed to load scheduled events:', error);
      }
    }
  }

  private async saveEvents(): Promise<void> {
    try {
      const events = Array.from(this.events.values());
      const data = JSON.stringify(events, null, 2);

      await fs.mkdir(path.dirname(this.persistencePath), { recursive: true });

      // Write to temp file first, then rename (atomic operation)
      const tempPath = `${this.persistencePath}.tmp`;
      await fs.writeFile(tempPath, data);
      await fs.rename(tempPath, this.persistencePath);

      this.isDirty = false;
      logger.debug(`Saved ${events.length} events to persistence`);
    } catch (error) {
      logger.error('Failed to save scheduled events:', error);
      throw error;
    }
  }

  private scheduleSave(): void {
    this.isDirty = true;

    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    // Debounce saves to avoid excessive I/O
    this.saveDebounceTimer = setTimeout(async () => {
      if (this.isDirty) {
        await this.saveEvents();
      }
    }, 1000);
  }

  private startCleanupInterval(): void {
    setInterval(async () => {
      const cleaned = await this.cleanup();
      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} old events`);
      }
    }, this.cleanupIntervalHours * 60 * 60 * 1000);
  }

  async add(event: Omit<ScheduledEvent, 'createdAt' | 'updatedAt' | 'retryCount'>): Promise<ScheduledEvent> {
    const now = new Date();
    const fullEvent: ScheduledEvent = {
      ...event,
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
      maxRetries: event.maxRetries || this.maxRetries
    };

    // Ensure Date objects
    if (typeof fullEvent.scheduledFor === 'string') {
      fullEvent.scheduledFor = new Date(fullEvent.scheduledFor);
    }

    this.events.set(fullEvent.id, fullEvent);
    this.scheduleSave();

    logger.debug(`Added event ${fullEvent.id} scheduled for ${fullEvent.scheduledFor}`);
    return fullEvent;
  }

  async addBatch(events: Omit<ScheduledEvent, 'createdAt' | 'updatedAt' | 'retryCount'>[]): Promise<ScheduledEvent[]> {
    const now = new Date();
    const addedEvents: ScheduledEvent[] = [];

    for (const event of events) {
      const fullEvent: ScheduledEvent = {
        ...event,
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        maxRetries: event.maxRetries || this.maxRetries
      };

      if (typeof fullEvent.scheduledFor === 'string') {
        fullEvent.scheduledFor = new Date(fullEvent.scheduledFor);
      }

      this.events.set(fullEvent.id, fullEvent);
      addedEvents.push(fullEvent);
    }

    this.scheduleSave();
    logger.info(`Added batch of ${addedEvents.length} events`);
    return addedEvents;
  }

  async get(id: string): Promise<ScheduledEvent | null> {
    return this.events.get(id) || null;
  }

  async update(id: string, updates: Partial<ScheduledEvent>): Promise<ScheduledEvent | null> {
    const event = this.events.get(id);
    if (!event) {
      return null;
    }

    const updatedEvent = {
      ...event,
      ...updates,
      id: event.id, // Prevent ID changes
      updatedAt: new Date()
    };

    this.events.set(id, updatedEvent);
    this.scheduleSave();

    return updatedEvent;
  }

  async remove(id: string): Promise<boolean> {
    const existed = this.events.delete(id);
    if (existed) {
      this.scheduleSave();
    }
    return existed;
  }

  async query(filter: EventFilter): Promise<ScheduledEvent[]> {
    let results = Array.from(this.events.values());

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      results = results.filter(e => statuses.includes(e.status));
    }

    if (filter.pluginName) {
      results = results.filter(e => e.pluginName === filter.pluginName);
    }

    if (filter.afterDate) {
      const after = filter.afterDate.getTime();
      results = results.filter(e => {
        const scheduled = e.scheduledFor instanceof Date ? e.scheduledFor : new Date(e.scheduledFor);
        return scheduled.getTime() >= after;
      });
    }

    if (filter.beforeDate) {
      const before = filter.beforeDate.getTime();
      results = results.filter(e => {
        const scheduled = e.scheduledFor instanceof Date ? e.scheduledFor : new Date(e.scheduledFor);
        return scheduled.getTime() <= before;
      });
    }

    return results.sort((a, b) => {
      const aTime = a.scheduledFor instanceof Date ? a.scheduledFor : new Date(a.scheduledFor);
      const bTime = b.scheduledFor instanceof Date ? b.scheduledFor : new Date(b.scheduledFor);
      return aTime.getTime() - bTime.getTime();
    });
  }

  async getNextPending(limit: number = 10): Promise<ScheduledEvent[]> {
    const now = new Date();
    const pending = await this.query({
      status: 'pending',
      beforeDate: new Date(now.getTime() + 60000) // Events in next minute
    });

    return pending.slice(0, limit);
  }

  async markAsScheduled(id: string): Promise<void> {
    await this.update(id, { status: 'scheduled' });
  }

  async markAsSent(id: string): Promise<void> {
    await this.update(id, {
      status: 'sent',
      completedAt: new Date()
    });
  }

  async markAsFailed(id: string, error: string): Promise<void> {
    const event = await this.get(id);
    if (!event) return;

    const newRetryCount = event.retryCount + 1;

    if (newRetryCount >= event.maxRetries) {
      await this.update(id, {
        status: 'failed',
        retryCount: newRetryCount,
        lastAttemptAt: new Date(),
        error
      });
      logger.error(`Event ${id} permanently failed after ${newRetryCount} attempts: ${error}`);
    } else {
      // Reschedule for retry (exponential backoff)
      const delayMs = Math.min(Math.pow(2, newRetryCount) * 1000, 60000); // Max 1 minute
      const newScheduledTime = new Date(Date.now() + delayMs);

      await this.update(id, {
        status: 'pending',
        retryCount: newRetryCount,
        scheduledFor: newScheduledTime,
        lastAttemptAt: new Date(),
        error
      });

      logger.warn(`Event ${id} failed (attempt ${newRetryCount}/${event.maxRetries}), retrying in ${delayMs}ms`);
    }
  }

  async cleanup(): Promise<number> {
    const cutoffTime = new Date(Date.now() - this.retentionHours * 60 * 60 * 1000);
    let removedCount = 0;

    for (const [id, event] of this.events.entries()) {
      const shouldRemove =
        (event.status === 'sent' || event.status === 'failed') &&
        event.updatedAt < cutoffTime;

      if (shouldRemove) {
        this.events.delete(id);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.scheduleSave();
    }

    return removedCount;
  }

  async clear(): Promise<void> {
    this.events.clear();
    await this.saveEvents();
  }

  async getStats(): Promise<{
    pending: number;
    scheduled: number;
    sent: number;
    failed: number;
    total: number;
  }> {
    const stats = {
      pending: 0,
      scheduled: 0,
      sent: 0,
      failed: 0,
      total: this.events.size
    };

    for (const event of this.events.values()) {
      stats[event.status]++;
    }

    return stats;
  }

  async shutdown(): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    if (this.isDirty) {
      await this.saveEvents();
    }

    logger.info('EventQueue shutdown complete');
  }
}