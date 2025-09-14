import { IPlugin, PluginConfig, NotificationData, ScheduleConfig, PluginMetadata } from '../../types';
import { logger } from '../../utils/logger';

export abstract class BasePlugin implements IPlugin {
  protected config: PluginConfig;
  protected metadata: PluginMetadata;

  constructor(config: PluginConfig, metadata: PluginMetadata) {
    this.config = config;
    this.metadata = metadata;
  }

  get name(): string {
    return this.metadata.name;
  }

  get version(): string {
    return this.metadata.version;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async initialize(): Promise<void> {
    logger.info(`Initializing plugin: ${this.name} v${this.version}`);
    await this.onInitialize();
    logger.info(`Plugin ${this.name} initialized successfully`);
  }

  async cleanup(): Promise<void> {
    logger.info(`Cleaning up plugin: ${this.name}`);
    await this.onCleanup();
    logger.info(`Plugin ${this.name} cleaned up successfully`);
  }

  abstract getSchedules(): ScheduleConfig[];
  abstract checkConditions(): Promise<NotificationData[]>;

  protected abstract onInitialize(): Promise<void>;
  protected abstract onCleanup(): Promise<void>;

  protected log(level: 'info' | 'warn' | 'error' | 'debug', message: string, meta?: any): void {
    logger[level](`[${this.name}] ${message}`, meta);
  }

  protected getPluginConfig<T = Record<string, any>>(): T {
    return this.config.config as T;
  }

  protected isEnabled(): boolean {
    return this.enabled;
  }
}