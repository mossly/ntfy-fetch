import * as cron from 'node-cron';
import { PluginManager } from './PluginManager';
import { NotificationService } from './NotificationService';
import { ScheduleConfig } from '../types';
import { logger } from '../utils/logger';
import { eventBus } from './EventBus';

interface ScheduledTask {
  name: string;
  expression: string;
  description: string;
  task: cron.ScheduledTask;
  pluginName: string;
  paused: boolean;
}

export class Scheduler {
  private pluginManager: PluginManager;
  private notificationService: NotificationService;
  private scheduledTasks: Map<string, ScheduledTask>;
  private running: boolean = false;

  constructor(pluginManager: PluginManager, notificationService: NotificationService) {
    this.pluginManager = pluginManager;
    this.notificationService = notificationService;
    this.scheduledTasks = new Map();
  }

  async start(): Promise<void> {
    logger.info('Starting scheduler');

    await this.schedulePluginTasks();

    logger.info(`Scheduler started with ${this.scheduledTasks.size} scheduled tasks`);
    this.running = true;
    eventBus.emit('event', { type: 'scheduler:state', state: 'running' });
  }

  async stop(): Promise<void> {
    logger.info('Stopping scheduler');

    for (const [name, scheduledTask] of this.scheduledTasks) {
      try {
        scheduledTask.task.stop();
        logger.debug(`Stopped scheduled task: ${name}`);
      } catch (error) {
        logger.error(`Failed to stop scheduled task ${name}:`, error);
      }
    }

    this.scheduledTasks.clear();
    logger.info('Scheduler stopped');
    this.running = false;
    eventBus.emit('event', { type: 'scheduler:state', state: 'stopped' });
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async schedulePluginTasks(): Promise<void> {
    const plugins = this.pluginManager.getEnabledPlugins();

    for (const plugin of plugins) {
      try {
        const schedules = plugin.getSchedules();

        for (const schedule of schedules) {
          if (!schedule.enabled) {
            logger.debug(`Skipping disabled schedule: ${schedule.description} for plugin ${plugin.name}`);
            continue;
          }

          await this.scheduleTask(plugin.name, schedule);
        }
      } catch (error) {
        logger.error(`Failed to schedule tasks for plugin ${plugin.name}:`, error);
      }
    }
  }

  private async scheduleTask(pluginName: string, schedule: ScheduleConfig): Promise<void> {
    const taskName = `${pluginName}-${schedule.description.replace(/\s+/g, '-').toLowerCase()}`;

    if (this.scheduledTasks.has(taskName)) {
      logger.warn(`Task ${taskName} already scheduled, skipping`);
      return;
    }

    if (!cron.validate(schedule.expression)) {
      logger.error(`Invalid cron expression for ${taskName}: ${schedule.expression}`);
      return;
    }

    try {
      const task = cron.schedule(
        schedule.expression,
        async () => {
          await this.executePluginTask(pluginName, schedule.description);
        },
        {
          scheduled: false, // Don't start immediately
          timezone: process.env.TZ || 'Pacific/Rarotonga'
        }
      );

      const scheduledTask: ScheduledTask = {
        name: taskName,
        expression: schedule.expression,
        description: schedule.description,
        task,
        pluginName,
        paused: false
      };

      this.scheduledTasks.set(taskName, scheduledTask);

      // Start the task
      task.start();

      logger.info(`Scheduled task: ${taskName} with expression "${schedule.expression}"`);
      eventBus.emit('event', { type: 'task:scheduled', task: { name: taskName, pluginName, expression: schedule.expression, description: schedule.description } });
    } catch (error) {
      logger.error(`Failed to schedule task ${taskName}:`, error);
    }
  }

  private async executePluginTask(pluginName: string, taskDescription: string): Promise<void> {
    const startTime = Date.now();
    logger.debug(`Executing task: ${taskDescription} for plugin ${pluginName}`);
    eventBus.emit('event', { type: 'job:started', pluginName, taskDescription, at: startTime });

    try {
      const plugin = this.pluginManager.getPlugin(pluginName);
      if (!plugin) {
        logger.error(`Plugin ${pluginName} not found for task execution`);
        return;
      }

      const notifications = await plugin.checkConditions({ description: taskDescription });

      if (notifications.length > 0) {
        logger.info(`Plugin ${pluginName} generated ${notifications.length} notifications`);

        const successCount = await this.notificationService.sendBulkNotifications(notifications);

        if (successCount !== notifications.length) {
          logger.warn(`Only sent ${successCount}/${notifications.length} notifications for plugin ${pluginName}`);
        }
      } else {
        logger.debug(`Plugin ${pluginName} generated no notifications`);
      }

      const duration = Date.now() - startTime;
      logger.debug(`Task ${taskDescription} completed in ${duration}ms`);
      eventBus.emit('event', { type: 'job:completed', pluginName, taskDescription, at: Date.now(), durationMs: duration });

    } catch (error) {
      logger.error(`Error executing task ${taskDescription} for plugin ${pluginName}:`, error);
      eventBus.emit('event', { type: 'job:failed', pluginName, taskDescription, at: Date.now(), error: (error as any)?.message || 'Unknown error' });
    }
  }

  async executeOnceNow(pluginName?: string): Promise<void> {
    logger.info(`Executing immediate check${pluginName ? ` for plugin ${pluginName}` : ' for all plugins'}`);

    const plugins = pluginName
      ? [this.pluginManager.getPlugin(pluginName)].filter(Boolean) as any[]
      : this.pluginManager.getEnabledPlugins();

    for (const plugin of plugins) {
      try {
        const notifications = await plugin.checkConditions({ description: 'manual execution' });

        if (notifications.length > 0) {
          logger.info(`Plugin ${plugin.name} generated ${notifications.length} notifications`);

          const successCount = await this.notificationService.sendBulkNotifications(notifications);

          if (successCount !== notifications.length) {
            logger.warn(`Only sent ${successCount}/${notifications.length} notifications for plugin ${plugin.name}`);
          }
        } else {
          logger.debug(`Plugin ${plugin.name} generated no notifications`);
        }
      } catch (error) {
        logger.error(`Error executing manual check for plugin ${plugin.name}:`, error);
      }
    }
  }

  getScheduledTasks(): Array<{
    name: string;
    expression: string;
    description: string;
    pluginName: string;
    nextRun: Date | null;
    paused: boolean;
  }> {
    return Array.from(this.scheduledTasks.values()).map(task => ({
      name: task.name,
      expression: task.expression,
      description: task.description,
      pluginName: task.pluginName,
      nextRun: null, // node-cron doesn't provide nextDate method
      paused: task.paused
    }));
  }

  getState(): { state: 'running' | 'stopped'; taskCount: number } {
    return {
      state: this.running ? 'running' : 'stopped',
      taskCount: this.scheduledTasks.size
    };
  }

  async addCustomSchedule(
    name: string,
    expression: string,
    description: string,
    callback: () => Promise<void>
  ): Promise<void> {
    if (this.scheduledTasks.has(name)) {
      throw new Error(`Task ${name} already exists`);
    }

    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression: ${expression}`);
    }

    const task = cron.schedule(
      expression,
      async () => {
        try {
          logger.debug(`Executing custom task: ${name}`);
          await callback();
        } catch (error) {
          logger.error(`Error executing custom task ${name}:`, error);
        }
      },
      {
        scheduled: true,
        timezone: process.env.TZ || 'Pacific/Rarotonga'
      }
    );

    const scheduledTask: ScheduledTask = {
      name,
      expression,
      description,
      task,
      pluginName: 'custom',
      paused: false
    };

    this.scheduledTasks.set(name, scheduledTask);
    logger.info(`Added custom scheduled task: ${name}`);
  }

  removeScheduledTask(name: string): boolean {
    const scheduledTask = this.scheduledTasks.get(name);
    if (!scheduledTask) {
      return false;
    }

    scheduledTask.task.stop();
    this.scheduledTasks.delete(name);

    logger.info(`Removed scheduled task: ${name}`);
    eventBus.emit('event', { type: 'task:removed', name });
    return true;
  }

  pauseTask(name: string): boolean {
    const scheduledTask = this.scheduledTasks.get(name);
    if (!scheduledTask || scheduledTask.paused) {
      return false;
    }

    scheduledTask.task.stop();
    scheduledTask.paused = true;

    logger.info(`Paused scheduled task: ${name}`);
    eventBus.emit('event', { type: 'task:paused', name });
    return true;
  }

  resumeTask(name: string): boolean {
    const scheduledTask = this.scheduledTasks.get(name);
    if (!scheduledTask || !scheduledTask.paused) {
      return false;
    }

    scheduledTask.task.start();
    scheduledTask.paused = false;

    logger.info(`Resumed scheduled task: ${name}`);
    eventBus.emit('event', { type: 'task:resumed', name });
    return true;
  }

  toggleTask(name: string): boolean {
    const scheduledTask = this.scheduledTasks.get(name);
    if (!scheduledTask) {
      return false;
    }

    if (scheduledTask.paused) {
      return this.resumeTask(name);
    } else {
      return this.pauseTask(name);
    }
  }
}
