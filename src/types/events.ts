export interface ScheduledEvent {
  id: string;
  pluginName: string;
  eventType: string;
  scheduledFor: Date | string; // ISO string when serialized
  status: 'pending' | 'scheduled' | 'sent' | 'failed';
  retryCount: number;
  maxRetries: number;
  payload: {
    title: string;
    message: string;
    priority?: 'min' | 'low' | 'default' | 'high' | 'max';
    tags?: string[];
    [key: string]: any;
  };
  metadata?: {
    originalEventTime?: Date | string; // For tide times, etc.
    advanceMinutes?: number; // How many minutes before the actual event
    [key: string]: any;
  };
  createdAt: Date | string;
  updatedAt: Date | string;
  lastAttemptAt?: Date | string;
  completedAt?: Date | string;
  error?: string;
}

export interface EventQueueOptions {
  persistencePath?: string;
  cleanupIntervalHours?: number;
  retentionHours?: number;
  maxRetries?: number;
}

export interface EventSchedulerOptions {
  eventQueue: IEventQueue;
  checkIntervalMs?: number; // Fallback check interval
  scheduleHorizonHours?: number; // How far ahead to schedule in memory
  gracefulShutdownTimeoutMs?: number;
}

export interface EventFilter {
  status?: ScheduledEvent['status'] | ScheduledEvent['status'][];
  pluginName?: string;
  beforeDate?: Date;
  afterDate?: Date;
}

// Import type for EventQueue (will be implemented)
export interface IEventQueue {
  add(event: Omit<ScheduledEvent, 'createdAt' | 'updatedAt' | 'retryCount'>): Promise<ScheduledEvent>;
  addBatch(events: Omit<ScheduledEvent, 'createdAt' | 'updatedAt' | 'retryCount'>[]): Promise<ScheduledEvent[]>;
  get(id: string): Promise<ScheduledEvent | null>;
  update(id: string, updates: Partial<ScheduledEvent>): Promise<ScheduledEvent | null>;
  remove(id: string): Promise<boolean>;
  query(filter: EventFilter): Promise<ScheduledEvent[]>;
  getNextPending(limit?: number): Promise<ScheduledEvent[]>;
  markAsScheduled(id: string): Promise<void>;
  markAsSent(id: string): Promise<void>;
  markAsFailed(id: string, error: string): Promise<void>;
  cleanup(): Promise<number>;
  clear(): Promise<void>;
  shutdown(): Promise<void>;
  getStats(): Promise<{
    pending: number;
    scheduled: number;
    sent: number;
    failed: number;
    total: number;
  }>;
}