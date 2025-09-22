import http from 'http';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { PluginManager } from '../core/PluginManager';
import { Scheduler } from '../core/Scheduler';
import { StateRegistry } from './stateRegistry';
import { eventBus } from '../core/EventBus';
import { logger } from '../utils/logger';

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

    const onEvent = (evt: any) => send('update', evt);
    eventBus.on('event', onEvent);

    req.on('close', () => {
      eventBus.off('event', onEvent);
      res.end();
    });
  });

  // Static UI (built assets live in dist/ui)
  // Resolve UI dir robustly: env override -> compiled-relative -> cwd fallback
  const candidates: string[] = [];
  if (process.env.WEBUI_DIR) candidates.push(path.resolve(process.env.WEBUI_DIR));
  candidates.push(path.resolve(__dirname, '..', 'ui'));
  candidates.push(path.resolve(process.cwd(), 'dist', 'ui'));

  const found = candidates.find((c) => fs.existsSync(path.join(c, 'index.html')));
  const uiDir = found || candidates[0];

  if (!found) {
    logger.warn(`Web UI assets not found at ${uiDir}. The /ui route will 404 until the UI is built (run \`npm run web:build\`).`);
  } else {
    logger.info(`Serving Web UI from ${uiDir}`);
  }

  // Serve static assets. We mount both /ui (preferred) and /assets (to support builds with absolute asset paths)
  app.use('/ui', express.static(uiDir));
  app.use('/assets', express.static(path.join(uiDir, 'assets')));

  // Serve index.html for UI root and SPA routes
  app.get('/ui', (_req, res) => res.sendFile(path.join(uiDir, 'index.html')));
  app.get('/ui/*', (_req, res) => res.sendFile(path.join(uiDir, 'index.html')));  app.get('/', (_req, res) => res.redirect('/ui'));

  return { app, server, registry };
}
