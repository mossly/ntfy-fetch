import { PluginManager } from '../core/PluginManager';
import { Scheduler } from '../core/Scheduler';
import { EventEmitter } from 'events';

export interface SystemSnapshot {
  system: {
    uptimeSec: number;
    schedulerState: 'running' | 'stopped';
    taskCount: number;
  };
  plugins: Array<{ name: string; enabled: boolean; initialized: boolean; version: string }>;
  tasks: Array<{
    name: string;
    expression: string;
    description: string;
    pluginName: string;
    nextRun: Date | null;
  }>;
}

export class StateRegistry {
  private readonly startedAt: number = Date.now();
  private readonly bus = new EventEmitter();

  constructor(private pluginManager: PluginManager, private scheduler: Scheduler) {}

  getSnapshot(): SystemSnapshot {
    const schedState = this.scheduler.getState();
    return {
      system: {
        uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
        schedulerState: schedState.state,
        taskCount: schedState.taskCount,
      },
      plugins: this.pluginManager.getPluginStatus(),
      tasks: this.scheduler.getScheduledTasks(),
    };
  }

  publish(event: any): void {
    this.bus.emit('event', event);
  }

  subscribe(listener: (event: any) => void): () => void {
    this.bus.on('event', listener);
    return () => this.bus.off('event', listener);
  }
}

