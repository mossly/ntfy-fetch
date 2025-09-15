import * as cron from 'node-cron';
import { PluginManager } from './PluginManager';
import { NotificationService } from './NotificationService';
import { ScheduleConfig } from '../types';
import { logger } from '../utils/logger';

interface ScheduledTask {
  name: string;
  expression: string;
  description: string;
  task: cron.ScheduledTask;
  pluginName: string;
}

export class Scheduler {
  private pluginManager: PluginManager;
  private notificationService: NotificationService;
  private scheduledTasks: Map<string, ScheduledTask>;

  constructor(pluginManager: PluginManager, notificationService: NotificationService) {
    this.pluginManager = pluginManager;
    this.notificationService = notificationService;
    this.scheduledTasks = new Map();
  }

  async start(): Promise<void> {
    logger.info('Starting scheduler');

    await this.schedulePluginTasks();

    logger.info(`Scheduler started with ${this.scheduledTasks.size} scheduled tasks`);
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
        pluginName
      };

      this.scheduledTasks.set(taskName, scheduledTask);

      // Start the task
      task.start();

      logger.info(`Scheduled task: ${taskName} with expression "${schedule.expression}"`);
    } catch (error) {
      logger.error(`Failed to schedule task ${taskName}:`, error);
    }
  }

  private async executePluginTask(pluginName: string, taskDescription: string): Promise<void> {
    const startTime = Date.now();
    logger.debug(`Executing task: ${taskDescription} for plugin ${pluginName}`);

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

    } catch (error) {
      logger.error(`Error executing task ${taskDescription} for plugin ${pluginName}:`, error);
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
  }> {
    return Array.from(this.scheduledTasks.values()).map(task => ({
      name: task.name,
      expression: task.expression,
      description: task.description,
      pluginName: task.pluginName,
      nextRun: null // node-cron doesn't provide nextDate method
    }));
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
      pluginName: 'custom'
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
    return true;
  }
}