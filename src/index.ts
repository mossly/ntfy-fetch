import { ConfigManager } from './config';
import { PluginManager } from './core/PluginManager';
import { NotificationService } from './core/NotificationService';
import { Scheduler } from './core/Scheduler';
import { logger } from './utils/logger';

class NtfyFetchService {
  private configManager: ConfigManager;
  private pluginManager: PluginManager;
  private notificationService: NotificationService;
  private scheduler: Scheduler;
  private isRunning: boolean = false;

  constructor() {
    this.configManager = ConfigManager.getInstance();

    const config = this.configManager.getConfig();

    this.pluginManager = new PluginManager(config.plugins);
    this.notificationService = new NotificationService(config.ntfy);
    this.scheduler = new Scheduler(this.pluginManager, this.notificationService);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Service is already running');
      return;
    }

    try {
      logger.info('Starting ntfy-fetch service...');

      // Test ntfy connection
      const connectionTest = await this.notificationService.testConnection();
      if (!connectionTest) {
        logger.warn('Failed to test ntfy connection - service will continue but notifications may fail');
      }

      // Initialize plugins
      await this.pluginManager.initializePlugins();

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

      // Cleanup plugins
      await this.pluginManager.cleanupPlugins();

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

  getStatus(): {
    running: boolean;
    plugins: Array<{ name: string; enabled: boolean; initialized: boolean; version: string }>;
    scheduledTasks: Array<{
      name: string;
      expression: string;
      description: string;
      pluginName: string;
      nextRun: Date | null;
    }>;
  } {
    return {
      running: this.isRunning,
      plugins: this.pluginManager.getPluginStatus(),
      scheduledTasks: this.scheduler.getScheduledTasks()
    };
  }

  private async sendStartupNotification(): Promise<void> {
    try {
      const config = this.configManager.getConfig();
      const enabledPluginsCount = config.plugins.filter(p => p.enabled).length;
      const scheduledTasksCount = this.scheduler.getScheduledTasks().length;

      await this.notificationService.sendNotification({
        title: 'ntfy-fetch Started',
        message: `Service started with ${enabledPluginsCount} plugins and ${scheduledTasksCount} scheduled tasks`,
        priority: 'low',
        tags: ['startup', 'service']
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
  const service = new NtfyFetchService();

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
        const status = service.getStatus();
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
  npm start              Start the service (default)
  npm run dev            Start in development mode with file watching
  npm test              Run immediate test execution

Commands:
  node dist/index.js start    Start the service
  node dist/index.js test     Run immediate test and exit
  node dist/index.js status   Show service status

Environment variables:
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