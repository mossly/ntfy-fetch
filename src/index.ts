import { ConfigManager } from './config';
import { PluginManager } from './core/PluginManager';
import { NotificationService } from './core/NotificationService';
import { Scheduler } from './core/Scheduler';
import { EventQueue } from './core/EventQueue';
import { EventScheduler } from './core/EventScheduler';
import { logger } from './utils/logger';
import { TidePluginV2 } from './plugins/tide/TidePluginV2';

class NtfyFetchService {
  private configManager: ConfigManager;
  private pluginManager: PluginManager;
  private notificationService: NotificationService;
  private scheduler: Scheduler;
  private eventQueue: EventQueue | null = null;
  private eventScheduler: EventScheduler | null = null;
  private isRunning: boolean = false;
  private useEventScheduler: boolean;

  constructor(useEventScheduler: boolean = false) {
    this.configManager = ConfigManager.getInstance();
    this.useEventScheduler = useEventScheduler;

    const config = this.configManager.getConfig();

    this.pluginManager = new PluginManager(config.plugins);
    this.notificationService = new NotificationService(config.ntfy);
    this.scheduler = new Scheduler(this.pluginManager, this.notificationService);

    // Initialize event scheduling system if enabled
    if (this.useEventScheduler) {
      this.eventQueue = new EventQueue({
        persistencePath: './data/scheduled-events.json',
        cleanupIntervalHours: 24,
        retentionHours: 48,
        maxRetries: 3
      });

      this.eventScheduler = new EventScheduler(this.notificationService, {
        eventQueue: this.eventQueue,
        checkIntervalMs: 60000, // Check every minute
        scheduleHorizonHours: 6, // Schedule 6 hours ahead in memory
        gracefulShutdownTimeoutMs: 5000
      });
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Service is already running');
      return;
    }

    try {
      logger.info(`Starting ntfy-fetch service${this.useEventScheduler ? ' with event scheduler' : ''}...`);

      // Test ntfy connection
      const connectionTest = await this.notificationService.testConnection();
      if (!connectionTest) {
        logger.warn('Failed to test ntfy connection - service will continue but notifications may fail');
      }

      // Initialize plugins
      await this.pluginManager.initializePlugins();

      // If using event scheduler, connect it to TidePluginV2
      if (this.useEventScheduler && this.eventScheduler) {
        const tidePlugin = this.pluginManager.getPlugin('tide');
        if (tidePlugin && tidePlugin instanceof TidePluginV2) {
          await tidePlugin.setEventScheduler(this.eventScheduler);
          logger.info('Connected event scheduler to TidePluginV2');
        }

        // Start the event scheduler
        await this.eventScheduler.start();
      }

      // Start scheduler
      await this.scheduler.start();

      this.isRunning = true;
      logger.info('🚀 ntfy-fetch service started successfully');

      // Send startup notification
      await this.sendStartupNotification();

    } catch (error) {
      logger.error('Failed to start service:', error);
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.info('Service is already stopped');
      return;
    }

    try {
      logger.info('Stopping ntfy-fetch service...');

      // Stop scheduler
      await this.scheduler.stop();

      // Stop event scheduler if enabled
      if (this.eventScheduler) {
        await this.eventScheduler.stop();
      }

      // Cleanup plugins
      await this.pluginManager.cleanupPlugins();

      // Shutdown event queue if enabled
      if (this.eventQueue) {
        await this.eventQueue.shutdown();
      }

      this.isRunning = false;
      logger.info('Service stopped successfully');

    } catch (error) {
      logger.error('Error during service shutdown:', error);
      throw error;
    }
  }

  async restart(): Promise<void> {
    logger.info('Restarting service...');
    await this.stop();
    await this.start();
  }

  async executeNow(pluginName?: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Service is not running');
    }

    await this.scheduler.executeOnceNow(pluginName);
  }

  async getStatus(): Promise<{
    running: boolean;
    plugins: Array<{ name: string; enabled: boolean; initialized: boolean; version: string }>;
    scheduledTasks: Array<{
      name: string;
      expression: string;
      description: string;
      pluginName: string;
      nextRun: Date | null;
    }>;
    eventScheduler?: {
      enabled: boolean;
      scheduledInMemory?: number;
      queueStats?: {
        pending: number;
        scheduled: number;
        sent: number;
        failed: number;
        total: number;
      };
    };
  }> {
    const status: any = {
      running: this.isRunning,
      plugins: this.pluginManager.getPluginStatus(),
      scheduledTasks: this.scheduler.getScheduledTasks()
    };

    if (this.useEventScheduler && this.eventScheduler) {
      const eventStats = await this.eventScheduler.getStats();
      status.eventScheduler = {
        enabled: true,
        scheduledInMemory: eventStats.scheduledInMemory,
        queueStats: eventStats.queueStats
      };
    } else {
      status.eventScheduler = {
        enabled: false
      };
    }

    return status;
  }

  private async sendStartupNotification(): Promise<void> {
    try {
      const config = this.configManager.getConfig();
      const enabledPluginsCount = config.plugins.filter(p => p.enabled).length;
      const scheduledTasksCount = this.scheduler.getScheduledTasks().length;

      let message = `Service started with ${enabledPluginsCount} plugins and ${scheduledTasksCount} scheduled tasks`;

      if (this.useEventScheduler) {
        message += '\n✨ Event scheduler enabled for precise notifications';
      }

      await this.notificationService.sendNotification({
        title: 'ntfy-fetch Started',
        message,
        priority: 'low',
        isDebug: true
      });
    } catch (error) {
      logger.warn('Failed to send startup notification:', error);
    }
  }

  private setupGracefulShutdown(): void {
    const shutdownHandler = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);

      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.on('SIGINT', () => shutdownHandler('SIGINT'));
  }
}

// CLI handler for direct execution
async function main() {
  // Check if event scheduler should be enabled
  const useEventScheduler = process.env.USE_EVENT_SCHEDULER === 'true' || process.argv.includes('--event-scheduler');

  const service = new NtfyFetchService(useEventScheduler);

  // Setup graceful shutdown
  const shutdownHandler = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      await service.stop();
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));

  // Handle command line arguments
  const command = process.argv[2];

  switch (command) {
    case 'start':
      try {
        await service.start();
        // Keep the process running
        process.stdin.resume();
      } catch (error) {
        logger.error('Failed to start service:', error);
        process.exit(1);
      }
      break;

    case 'test':
      try {
        await service.start();
        logger.info('Running immediate test execution...');
        await service.executeNow();
        await service.stop();
        logger.info('Test execution completed');
        process.exit(0);
      } catch (error) {
        logger.error('Test execution failed:', error);
        process.exit(1);
      }
      break;

    case 'status':
      try {
        const status = await service.getStatus();
        console.log(JSON.stringify(status, null, 2));
        process.exit(0);
      } catch (error) {
        logger.error('Failed to get status:', error);
        process.exit(1);
      }
      break;

    default:
      console.log(`
ntfy-fetch - Extensible notification service

Usage:
  npm start                    Start the service (default)
  npm run dev                  Start in development mode with file watching
  npm test                     Run immediate test execution

Commands:
  node dist/index.js start                  Start the service
  node dist/index.js start --event-scheduler Start with event scheduler (precise timing)
  node dist/index.js test                   Run immediate test and exit
  node dist/index.js status                 Show service status

Environment variables:
  USE_EVENT_SCHEDULER=true     Enable event scheduler for precise notifications
  See .env.example for required configuration
      `);

      if (!command) {
        // Default to start if no command provided
        try {
          await service.start();
          process.stdin.resume();
        } catch (error) {
          logger.error('Failed to start service:', error);
          process.exit(1);
        }
      } else {
        process.exit(1);
      }
      break;
  }
}

// Only run main if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    logger.error('Unhandled error in main:', error);
    process.exit(1);
  });
}

export { NtfyFetchService };