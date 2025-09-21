import http from 'http';
import express from 'express';
import path from 'path';
import { PluginManager } from '../core/PluginManager';
import { Scheduler } from '../core/Scheduler';
import { StateRegistry } from './stateRegistry';

export function createWebServer(opts: { pluginManager: PluginManager; scheduler: Scheduler }) {
  const app = express();
  const server = http.createServer(app);
  const registry = new StateRegistry(opts.pluginManager, opts.scheduler);

  app.get('/api/health', (_req, res) => {
    res.json(registry.getSnapshot().system);
  });

  app.get('/api/plugins', (_req, res) => {
    res.json(registry.getSnapshot().plugins);
  });

  app.get('/api/tasks', (_req, res) => {
    res.json(registry.getSnapshot().tasks);
  });

  app.get('/api/snapshot', (_req, res) => {
    res.json(registry.getSnapshot());
  });

  app.get('/api/events/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Initial snapshot
    send('snapshot', registry.getSnapshot());

    const unsub = registry.subscribe((evt) => send('update', evt));

    req.on('close', () => {
      unsub();
      res.end();
    });
  });

  // Static UI (built assets live in dist/ui)
  const uiDir = path.join(process.cwd(), 'dist', 'ui');
  app.use('/ui', express.static(uiDir));
  app.get('/', (_req, res) => res.redirect('/ui'));

  return { app, server, registry };
}

