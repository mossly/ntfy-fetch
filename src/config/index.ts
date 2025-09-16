import { config } from 'dotenv';
import { AppConfig, NtfyConfig, PluginConfig } from '../types';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
config();

export class ConfigManager {
  private static instance: ConfigManager;
  private appConfig: AppConfig;

  private constructor() {
    this.appConfig = this.loadConfiguration();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public getConfig(): AppConfig {
    return this.appConfig;
  }

  public getNtfyConfig(): NtfyConfig {
    return this.appConfig.ntfy;
  }

  public getPluginConfigs(): PluginConfig[] {
    return this.appConfig.plugins;
  }

  public updateConfig(newConfig: Partial<AppConfig>): void {
    this.appConfig = { ...this.appConfig, ...newConfig };
    logger.info('Configuration updated');
  }

  public reloadConfig(): void {
    this.appConfig = this.loadConfiguration();
    logger.info('Configuration reloaded from sources');
  }

  private loadConfiguration(): AppConfig {
    const ntfyConfig = this.loadNtfyConfig();
    const pluginConfigs = this.loadPluginConfigs();

    const appConfig: AppConfig = {
      ntfy: ntfyConfig,
      plugins: pluginConfigs,
      timezone: process.env.TZ || 'Pacific/Rarotonga',
      logLevel: process.env.LOG_LEVEL || 'info',
      cacheConfig: {
        ttlHours: parseInt(process.env.CACHE_TTL_HOURS || '24', 10),
        refreshIntervalHours: parseInt(process.env.DATA_REFRESH_INTERVAL || '6', 10)
      }
    };

    logger.info('Configuration loaded successfully');
    this.validateConfiguration(appConfig);

    return appConfig;
  }

  private loadNtfyConfig(): NtfyConfig {
    const ntfyUrl = process.env.NTFY_URL;
    const ntfyTopic = process.env.NTFY_TOPIC;

    if (!ntfyUrl || !ntfyTopic) {
      throw new Error('NTFY_URL and NTFY_TOPIC environment variables are required');
    }

    const config: NtfyConfig = {
      url: ntfyUrl,
      topic: ntfyTopic
    };

    // Add authentication if provided
    const username = process.env.NTFY_USERNAME;
    const password = process.env.NTFY_PASSWORD;

    if (username && password) {
      config.auth = {
        type: 'basic',
        username,
        password
      };
    }

    return config;
  }

  private loadPluginConfigs(): PluginConfig[] {
    // Try to load from config file first
    const configPath = path.join(process.cwd(), 'config', 'plugins.json');

    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const configs = JSON.parse(configContent);
        logger.info('Loaded plugin configurations from file');
        return configs;
      } catch (error) {
        logger.warn('Failed to load plugin configuration file, using defaults', error);
      }
    }

    // Return default configuration
    return this.getDefaultPluginConfigs();
  }

  private getDefaultPluginConfigs(): PluginConfig[] {
    return [
      {
        name: 'tide',
        enabled: true,
        provider: 'noaa',
        config: {
          station: process.env.NOAA_STATION_ID || 'TPT2853',
          location: 'Arorangi, Rarotonga',
          timezone: 'Pacific/Rarotonga',
          notifications: {
            highTide: {
              enabled: true,
              priority: 'default',
              advanceNotice: [2, 10, 30], // Notify 2, 10, and 30 minutes before
              exactTime: true // Also notify at exact tide time
            },
            lowTide: {
              enabled: true,
              priority: 'low',
              advanceNotice: [2, 10], // Notify 2 and 10 minutes before
              exactTime: true
            },
            dailySummary: {
              enabled: true,
              time: '07:00'
            }
          },
          scheduling: {
            refreshIntervalHours: 6, // Refresh tide data every 6 hours
            scheduleAheadHours: 24 // Schedule events 24 hours ahead
          }
        }
      }
    ];
  }

  private validateConfiguration(config: AppConfig): void {
    const errors: string[] = [];

    // Validate ntfy config
    if (!config.ntfy.url) {
      errors.push('ntfy.url is required');
    }

    if (!config.ntfy.topic) {
      errors.push('ntfy.topic is required');
    }

    // Validate plugin configs
    if (!Array.isArray(config.plugins)) {
      errors.push('plugins must be an array');
    }

    for (const plugin of config.plugins) {
      if (!plugin.name) {
        errors.push('plugin.name is required');
      }

      if (typeof plugin.enabled !== 'boolean') {
        errors.push(`plugin.enabled must be boolean for plugin ${plugin.name}`);
      }

      if (!plugin.provider) {
        errors.push(`plugin.provider is required for plugin ${plugin.name}`);
      }

      // Validate tide plugin specific configuration
      if (plugin.name === 'tide') {
        this.validateTidePluginConfig(plugin, errors);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }

    logger.info('Configuration validation passed');
  }

  private validateTidePluginConfig(plugin: PluginConfig, errors: string[]): void {
    const config = plugin.config;

    if (!config.station) {
      errors.push(`tide plugin: station is required`);
    }

    if (!config.location) {
      errors.push(`tide plugin: location is required`);
    }

    if (!config.notifications) {
      errors.push(`tide plugin: notifications configuration is required`);
      return;
    }

    const notifications = config.notifications;

    if (notifications.highTide && typeof notifications.highTide.enabled !== 'boolean') {
      errors.push(`tide plugin: highTide.enabled must be boolean`);
    }

    if (notifications.lowTide && typeof notifications.lowTide.enabled !== 'boolean') {
      errors.push(`tide plugin: lowTide.enabled must be boolean`);
    }

    if (notifications.dailySummary && typeof notifications.dailySummary.enabled !== 'boolean') {
      errors.push(`tide plugin: dailySummary.enabled must be boolean`);
    }

    if (notifications.dailySummary && notifications.dailySummary.enabled) {
      const timePattern = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!notifications.dailySummary.time || !timePattern.test(notifications.dailySummary.time)) {
        errors.push(`tide plugin: dailySummary.time must be in HH:mm format`);
      }
    }
  }

  public savePluginConfigs(configs: PluginConfig[]): void {
    try {
      const configDir = path.join(process.cwd(), 'config');

      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const configPath = path.join(configDir, 'plugins.json');
      fs.writeFileSync(configPath, JSON.stringify(configs, null, 2));

      this.appConfig.plugins = configs;
      logger.info('Plugin configurations saved successfully');
    } catch (error) {
      logger.error('Failed to save plugin configurations:', error);
      throw error;
    }
  }
}