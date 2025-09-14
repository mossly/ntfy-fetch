export interface NotificationData {
  title: string;
  message: string;
  priority?: 'min' | 'low' | 'default' | 'high' | 'max';
  tags?: string[];
  click?: string;
  attach?: string;
}

export interface ScheduleConfig {
  expression: string;
  description: string;
  enabled: boolean;
}

export interface PluginConfig {
  name: string;
  enabled: boolean;
  provider: string;
  config: Record<string, any>;
}

export interface NtfyConfig {
  url: string;
  topic: string;
  auth?: {
    type: 'basic' | 'token';
    username?: string;
    password?: string;
    token?: string;
  };
}

export interface AppConfig {
  ntfy: NtfyConfig;
  plugins: PluginConfig[];
  timezone: string;
  logLevel: string;
  cacheConfig: {
    ttlHours: number;
    refreshIntervalHours: number;
  };
}

export interface IPlugin {
  name: string;
  version: string;
  initialize(): Promise<void>;
  getSchedules(): ScheduleConfig[];
  checkConditions(): Promise<NotificationData[]>;
  cleanup(): Promise<void>;
}

export interface IDataProvider<T> {
  fetch(params: Record<string, any>): Promise<T>;
  cache(data: T): Promise<void>;
  getCached(): Promise<T | null>;
  isStale(): Promise<boolean>;
}

export interface TideData {
  predictions: TidePrediction[];
  station: string;
  units: string;
  timeZone: string;
  fetchedAt: Date;
}

export interface TidePrediction {
  time: Date;
  height: number;
  type: 'H' | 'L'; // High or Low
}

export interface NOAAResponse {
  predictions?: Array<{
    t: string; // time
    v: string; // value (height)
    type: string; // H or L
  }>;
  error?: {
    message: string;
  };
}

export interface CachedData<T> {
  data: T;
  timestamp: Date;
  expiresAt: Date;
}

export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  dependencies?: string[];
}