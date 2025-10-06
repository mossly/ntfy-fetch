import http from 'http';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { PluginManager } from '../core/PluginManager';
import { Scheduler } from '../core/Scheduler';
import { EventScheduler } from '../core/EventScheduler';
import { StateRegistry } from './stateRegistry';
import { eventBus } from '../core/EventBus';
import { logger } from '../utils/logger';
import { createMcpServer } from '../mcp/server';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';

export function createWebServer(opts: {
  pluginManager: PluginManager;
  scheduler: Scheduler;
  eventScheduler?: EventScheduler;
}) {
  const app = express();
  const server = http.createServer(app);
  const registry = new StateRegistry(opts.pluginManager, opts.scheduler);

  // Apply JSON body parser to all routes EXCEPT MCP endpoints (MCP SDK needs raw stream)
  app.use((req, res, next) => {
    if (req.path === '/mcp/message' || req.path === '/mcp') {
      return next();
    }
    express.json()(req, res, next);
  });

  // ============================================
  // MCP Server Setup
  // ============================================
  const mcpServer = createMcpServer({
    registry,
    eventScheduler: opts.eventScheduler
  });

  // Track active SSE transports by session ID for message routing
  const activeTransports = new Map<string, SSEServerTransport>();

  // MCP SSE endpoint
  app.get('/mcp/sse', async (_req, res) => {
    logger.info('MCP client connected via SSE');

    const transport = new SSEServerTransport('/mcp/message', res);

    // Add detailed logging for transport events
    transport.onclose = () => {
      logger.info(`MCP transport closed (session: ${transport.sessionId})`);
      activeTransports.delete(transport.sessionId);
    };

    transport.onerror = (error) => {
      logger.error(`MCP transport error (session: ${transport.sessionId}):`, error);
      activeTransports.delete(transport.sessionId);
    };

    res.on('close', () => {
      activeTransports.delete(transport.sessionId);
      logger.info(`MCP client disconnected (session: ${transport.sessionId})`);
    });

    try {
      logger.info('Attempting to connect MCP server to transport');
      await mcpServer.connect(transport);
      logger.info(`MCP server successfully connected to transport (session: ${transport.sessionId})`);

      // Add to active transports AFTER successful connection
      activeTransports.set(transport.sessionId, transport);
    } catch (error) {
      logger.error('MCP connection error:', error);
      activeTransports.delete(transport.sessionId);
    }
  });

  // Store HTTP streaming transports by session ID
  const httpTransports = new Map<string, StreamableHTTPServerTransport>();

  // Handle all HTTP methods for MCP Streamable HTTP endpoint
  app.all('/mcp', async (req, res) => {
    logger.info(`MCP HTTP ${req.method} request received`);

    try {
      // Check for existing session ID in header
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && httpTransports.has(sessionId)) {
        // Reuse existing transport for this session
        transport = httpTransports.get(sessionId)!;
        logger.info(`Reusing HTTP transport for session: ${sessionId}`);
      } else if (!sessionId && req.method === 'POST') {
        // New session - create new transport
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true, // Use JSON responses instead of SSE streaming for better compatibility
          onsessioninitialized: async (newSessionId) => {
            logger.info(`MCP HTTP session initialized: ${newSessionId}`);
            httpTransports.set(newSessionId, transport);
          },
          onsessionclosed: async (closedSessionId) => {
            logger.info(`MCP HTTP session closed: ${closedSessionId}`);
            httpTransports.delete(closedSessionId);
          }
        });

        transport.onerror = (error: Error) => {
          logger.error(`MCP HTTP transport error (session: ${transport.sessionId}):`, error);
        };

        transport.onclose = () => {
          if (transport.sessionId) {
            logger.info(`MCP HTTP transport closed (session: ${transport.sessionId})`);
            httpTransports.delete(transport.sessionId);
          }
        };

        // Connect transport to MCP server
        await mcpServer.connect(transport);
        logger.info('MCP server connected to new HTTP streaming transport');
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided'
          },
          id: null
        });
        return;
      }

      // Handle the request with the transport
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('Error handling MCP HTTP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error'
          },
          id: null
        });
      }
    }
  });

  // MCP message endpoint - route messages to the correct transport by session ID
  app.post('/mcp/message', async (req, res) => {
    try {
      const sessionId = req.query.sessionId as string;

      if (!sessionId) {
        logger.error('MCP message received without sessionId');
        res.status(400).json({ error: 'sessionId required' });
        return;
      }

      const transport = activeTransports.get(sessionId);

      if (!transport) {
        logger.error(`MCP message received for unknown session: ${sessionId}`);
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      logger.info(`MCP message received for session: ${sessionId}`);
      await transport.handlePostMessage(req, res);
    } catch (error) {
      logger.error('Error handling MCP message:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ============================================
  // REST API Endpoints
  // ============================================
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

  app.post('/api/plugins/:name/toggle', async (req, res) => {
    try {
      const { name } = req.params;
      await registry.togglePlugin(name);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/tasks/:name/toggle', async (req, res) => {
    try {
      const { name } = req.params;
      await registry.toggleTask(name);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
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
