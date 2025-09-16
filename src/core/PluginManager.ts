import { IPlugin, PluginConfig } from '../types';
import { TidePlugin } from '../plugins/tide/TidePlugin';
import { TidePluginV2 } from '../plugins/tide/TidePluginV2';
import { logger } from '../utils/logger';

export class PluginManager {
  private plugins: Map<string, IPlugin>;
  private pluginConfigs: PluginConfig[];

  constructor(pluginConfigs: PluginConfig[]) {
    this.plugins = new Map();
    this.pluginConfigs = pluginConfigs;
  }

  async initializePlugins(): Promise<void> {
    logger.info(`Initializing ${this.pluginConfigs.length} plugins`);

    for (const config of this.pluginConfigs) {
      if (!config.enabled) {
        logger.info(`Skipping disabled plugin: ${config.name}`);
        continue;
      }

      try {
        const plugin = await this.createPlugin(config);
        await plugin.initialize();

        this.plugins.set(config.name, plugin);
        logger.info(`Plugin ${config.name} initialized successfully`);
      } catch (error) {
        logger.error(`Failed to initialize plugin ${config.name}:`, error);
        // Continue with other plugins
      }
    }

    logger.info(`Successfully initialized ${this.plugins.size} plugins`);
  }

  async cleanupPlugins(): Promise<void> {
    logger.info('Cleaning up all plugins');

    for (const [name, plugin] of this.plugins) {
      try {
        await plugin.cleanup();
        logger.info(`Plugin ${name} cleaned up successfully`);
      } catch (error) {
        logger.error(`Failed to cleanup plugin ${name}:`, error);
      }
    }

    this.plugins.clear();
    logger.info('All plugins cleaned up');
  }

  getPlugin(name: string): IPlugin | undefined {
    return this.plugins.get(name);
  }

  getAllPlugins(): IPlugin[] {
    return Array.from(this.plugins.values());
  }

  getEnabledPlugins(): IPlugin[] {
    return Array.from(this.plugins.values()).filter(plugin =>
      this.pluginConfigs.find(config =>
        config.name === plugin.name && config.enabled
      )
    );
  }

  async reloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    logger.info(`Reloading plugin: ${name}`);

    try {
      await plugin.cleanup();
      this.plugins.delete(name);

      const config = this.pluginConfigs.find(c => c.name === name);
      if (!config) {
        throw new Error(`Configuration for plugin ${name} not found`);
      }

      const newPlugin = await this.createPlugin(config);
      await newPlugin.initialize();

      this.plugins.set(name, newPlugin);
      logger.info(`Plugin ${name} reloaded successfully`);
    } catch (error) {
      logger.error(`Failed to reload plugin ${name}:`, error);
      throw error;
    }
  }

  private async createPlugin(config: PluginConfig): Promise<IPlugin> {
    switch (config.name) {
      case 'tide':
        // Check if event scheduler is enabled via environment variable or config
        const useEventScheduler = process.env.USE_EVENT_SCHEDULER === 'true' ||
                                  config.config?.useEventScheduler === true;

        if (useEventScheduler) {
          logger.info('Creating TidePluginV2 with event scheduler support');
          return new TidePluginV2(config);
        } else {
          return new TidePlugin(config);
        }

      case 'tide-v2':
        // Explicit V2 plugin creation
        return new TidePluginV2(config);

      default:
        throw new Error(`Unknown plugin type: ${config.name}`);
    }
  }

  async updatePluginConfigs(newConfigs: PluginConfig[]): Promise<void> {
    logger.info('Updating plugin configurations');

    const currentPluginNames = new Set(Array.from(this.plugins.keys()));
    const newPluginNames = new Set(newConfigs.map(c => c.name));

    // Cleanup removed plugins
    for (const name of currentPluginNames) {
      if (!newPluginNames.has(name)) {
        logger.info(`Removing plugin: ${name}`);
        const plugin = this.plugins.get(name);
        if (plugin) {
          await plugin.cleanup();
          this.plugins.delete(name);
        }
      }
    }

    // Update plugin configs
    this.pluginConfigs = newConfigs;

    // Initialize new plugins
    for (const config of newConfigs) {
      if (!config.enabled) {
        continue;
      }

      if (!this.plugins.has(config.name)) {
        try {
          logger.info(`Adding new plugin: ${config.name}`);
          const plugin = await this.createPlugin(config);
          await plugin.initialize();
          this.plugins.set(config.name, plugin);
        } catch (error) {
          logger.error(`Failed to add plugin ${config.name}:`, error);
        }
      }
    }

    logger.info('Plugin configurations updated successfully');
  }

  getPluginStatus(): { name: string; enabled: boolean; initialized: boolean; version: string }[] {
    return this.pluginConfigs.map(config => {
      const plugin = this.plugins.get(config.name);
      return {
        name: config.name,
        enabled: config.enabled,
        initialized: !!plugin,
        version: plugin?.version || 'unknown'
      };
    });
  }
}