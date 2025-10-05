import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { StateRegistry } from '../web/stateRegistry.js';
import { EventScheduler } from '../core/EventScheduler.js';
import { logger } from '../utils/logger.js';

export interface McpServerOptions {
  registry: StateRegistry;
  eventScheduler?: EventScheduler;
}

export function createMcpServer(options: McpServerOptions): Server {
  const { registry, eventScheduler } = options;

  const server = new Server(
    {
      name: 'ntfy-fetch',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [
      {
        name: 'list_plugins',
        description: 'List all notification plugins with their status and configuration',
        inputSchema: z.object({}).strict(),
      },
      {
        name: 'toggle_plugin',
        description: 'Enable or disable a notification plugin',
        inputSchema: z.object({
          name: z.string().describe('The name of the plugin to toggle'),
        }).strict(),
      },
      {
        name: 'list_tasks',
        description: 'List all scheduled tasks across all plugins',
        inputSchema: z.object({}).strict(),
      },
      {
        name: 'toggle_task',
        description: 'Pause or resume a scheduled task',
        inputSchema: z.object({
          name: z.string().describe('The name of the task to toggle'),
        }).strict(),
      },
      {
        name: 'get_system_status',
        description: 'Get current system status including uptime, scheduler state, and task count',
        inputSchema: z.object({}).strict(),
      },
    ];

    // Add event scheduler tools if available
    if (eventScheduler) {
      tools.push(
        {
          name: 'schedule_notification',
          description: 'Schedule a one-time notification to be sent at a specific time',
          inputSchema: z.object({
            title: z.string().describe('Notification title'),
            message: z.string().describe('Notification message body'),
            scheduledFor: z.string().describe('ISO 8601 datetime string (e.g., "2025-10-05T14:30:00-10:00")'),
            priority: z.enum(['min', 'low', 'default', 'high', 'max']).optional().describe('Priority level'),
            tags: z.array(z.string()).optional().describe('Optional list of tags for the notification'),
          }).strict(),
        },
        {
          name: 'list_scheduled_notifications',
          description: 'List all currently scheduled notifications (upcoming one-time events)',
          inputSchema: z.object({}).strict(),
        },
        {
          name: 'cancel_notification',
          description: 'Cancel a scheduled one-time notification',
          inputSchema: z.object({
            eventId: z.string().describe('ID of the event to cancel'),
          }).strict(),
        }
      );
    }

    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'list_plugins': {
          const snapshot = registry.getSnapshot();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(snapshot.plugins, null, 2),
              },
            ],
          };
        }

        case 'toggle_plugin': {
          const pluginName = (args as any)?.name as string;
          if (!pluginName) {
            throw new Error('Plugin name is required');
          }

          await registry.togglePlugin(pluginName);
          return {
            content: [
              {
                type: 'text',
                text: `Successfully toggled plugin: ${pluginName}`,
              },
            ],
          };
        }

        case 'list_tasks': {
          const snapshot = registry.getSnapshot();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(snapshot.tasks, null, 2),
              },
            ],
          };
        }

        case 'toggle_task': {
          const taskName = (args as any)?.name as string;
          if (!taskName) {
            throw new Error('Task name is required');
          }

          await registry.toggleTask(taskName);
          return {
            content: [
              {
                type: 'text',
                text: `Successfully toggled task: ${taskName}`,
              },
            ],
          };
        }

        case 'get_system_status': {
          const snapshot = registry.getSnapshot();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(snapshot.system, null, 2),
              },
            ],
          };
        }

        case 'schedule_notification': {
          if (!eventScheduler) {
            throw new Error('Event scheduler is not available');
          }

          const { title, message, scheduledFor, priority = 'default', tags = [] } = args as any;

          if (!title || !message || !scheduledFor) {
            throw new Error('title, message, and scheduledFor are required');
          }

          const scheduledDate = new Date(scheduledFor);
          if (isNaN(scheduledDate.getTime())) {
            throw new Error('Invalid date format for scheduledFor');
          }

          const event = await eventScheduler.addEvent({
            id: `custom-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            pluginName: 'mcp-custom',
            eventType: 'custom-notification',
            status: 'pending',
            scheduledFor: scheduledDate,
            maxRetries: 3,
            payload: {
              title,
              message,
              priority: priority as 'min' | 'low' | 'default' | 'high' | 'max',
              tags,
            },
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    eventId: event.id,
                    scheduledFor: event.scheduledFor,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'list_scheduled_notifications': {
          if (!eventScheduler) {
            throw new Error('Event scheduler is not available');
          }

          const scheduled = eventScheduler.getScheduledEvents();
          const stats = await eventScheduler.getStats();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    scheduled: scheduled.map((s) => ({
                      eventId: s.eventId,
                      scheduledFor: s.scheduledFor,
                      timeUntilMs: s.timeUntil,
                    })),
                    queueStats: stats.queueStats,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'cancel_notification': {
          if (!eventScheduler) {
            throw new Error('Event scheduler is not available');
          }

          const eventId = (args as any)?.eventId as string;
          if (!eventId) {
            throw new Error('eventId is required');
          }

          const cancelled = await eventScheduler.cancelEvent(eventId);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: cancelled, eventId }, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      logger.error(`MCP tool error (${name}):`, error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message || 'Unknown error occurred'}`,
          },
        ],
        isError: true,
      };
    }
  });

  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'ntfy://status',
          name: 'System Status',
          description: 'Current system status including uptime, scheduler state, and task count',
          mimeType: 'application/json',
        },
        {
          uri: 'ntfy://plugins',
          name: 'Plugin List',
          description: 'List of all plugins with their status',
          mimeType: 'application/json',
        },
        {
          uri: 'ntfy://tasks',
          name: 'Task List',
          description: 'List of all scheduled tasks',
          mimeType: 'application/json',
        },
      ],
    };
  });

  // Handle resource reads
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    try {
      const snapshot = registry.getSnapshot();

      switch (uri) {
        case 'ntfy://status':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(snapshot.system, null, 2),
              },
            ],
          };

        case 'ntfy://plugins':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(snapshot.plugins, null, 2),
              },
            ],
          };

        case 'ntfy://tasks':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(snapshot.tasks, null, 2),
              },
            ],
          };

        default:
          throw new Error(`Unknown resource: ${uri}`);
      }
    } catch (error: any) {
      logger.error(`MCP resource read error (${uri}):`, error);
      throw new Error(`Failed to read resource: ${error.message}`);
    }
  });

  logger.info('MCP server initialized with tools and resources');

  return server;
}
