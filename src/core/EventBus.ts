import { EventEmitter } from 'events';

// Simple global event bus to surface lifecycle events to the Web UI
export const eventBus = new EventEmitter();

// Increase max listeners to avoid warnings in larger installs
eventBus.setMaxListeners(50);

export type LifecycleEvent =
  | { type: 'scheduler:state'; state: 'running' | 'stopped' }
  | { type: 'task:scheduled'; task: { name: string; pluginName: string; expression: string; description: string } }
  | { type: 'task:removed'; name: string }
  | { type: 'job:started'; pluginName: string; taskDescription: string; at: number }
  | { type: 'job:completed'; pluginName: string; taskDescription: string; at: number; durationMs: number }
  | { type: 'job:failed'; pluginName: string; taskDescription: string; at: number; error: string }
  | { type: 'plugin:initialized'; name: string; version: string }
  | { type: 'plugin:cleanup'; name: string };

