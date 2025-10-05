# MCP Integration Guide

This document explains how to use the native MCP (Model Context Protocol) server embedded in ntfy-fetch.

## What is MCP?

The Model Context Protocol (MCP) is a standardized way for AI assistants like Claude to interact with external tools and data sources. ntfy-fetch now has native MCP support, allowing AI assistants to control notifications, manage plugins, and schedule custom alerts.

## MCP Endpoint

The MCP server is embedded in the ntfy-fetch web server and available at:

```
http://localhost:3000/mcp/sse
```

**Note**: The Web UI must be enabled (`WEBUI=true`) for the MCP endpoint to be available.

## Available MCP Tools

### Plugin Management

#### `list_plugins`
List all notification plugins with their status and configuration.

**Parameters**: None

**Example Response**:
```json
[
  {
    "name": "tide",
    "enabled": true,
    "initialized": true,
    "version": "2.0.0",
    "description": "Tide notifications for Avarua, Rarotonga"
  }
]
```

#### `toggle_plugin`
Enable or disable a notification plugin.

**Parameters**:
- `name` (string): The name of the plugin to toggle

**Example**:
```json
{
  "name": "tide"
}
```

### Task Management

#### `list_tasks`
List all scheduled tasks across all plugins.

**Parameters**: None

**Example Response**:
```json
[
  {
    "name": "tide-check",
    "expression": "*/10 * * * *",
    "description": "Check tide conditions every 10 minutes",
    "pluginName": "tide",
    "nextRun": "2025-10-05T10:10:00.000Z",
    "paused": false
  }
]
```

#### `toggle_task`
Pause or resume a scheduled task.

**Parameters**:
- `name` (string): The name of the task to toggle

### System Status

#### `get_system_status`
Get current system status including uptime, scheduler state, and task count.

**Parameters**: None

**Example Response**:
```json
{
  "uptimeSec": 3600,
  "schedulerState": "running",
  "taskCount": 3
}
```

### Custom Notifications (Event Scheduler Required)

**Note**: These tools are only available when the event scheduler is enabled (`USE_EVENT_SCHEDULER=true`).

#### `schedule_notification`
Schedule a one-time notification to be sent at a specific time.

**Parameters**:
- `title` (string): Notification title
- `message` (string): Notification message body
- `scheduledFor` (string): ISO 8601 datetime string (e.g., "2025-10-05T14:30:00-10:00")
- `priority` (string, optional): Priority level - "min", "low", "default", "high", or "max"
- `tags` (array of strings, optional): Tags for the notification

**Example**:
```json
{
  "title": "Reminder",
  "message": "Check the tide levels before heading out",
  "scheduledFor": "2025-10-05T14:30:00-10:00",
  "priority": "high",
  "tags": ["reminder", "tide"]
}
```

#### `list_scheduled_notifications`
List all currently scheduled notifications (upcoming one-time events).

**Parameters**: None

#### `cancel_notification`
Cancel a scheduled one-time notification.

**Parameters**:
- `eventId` (string): ID of the event to cancel

## Available MCP Resources

Resources provide read-only access to system data.

### `ntfy://status`
Current system status including uptime, scheduler state, and task count.

### `ntfy://plugins`
List of all plugins with their status.

### `ntfy://tasks`
List of all scheduled tasks.

## Using with MetaMCP

MetaMCP is a gateway that can aggregate multiple MCP servers. Here's how to configure ntfy-fetch with MetaMCP:

### MetaMCP Configuration

1. Access MetaMCP web interface (typically at `http://localhost:3876`)

2. Add a new MCP server with these settings:
   - **Name**: `ntfy-fetch`
   - **Type**: `sse` (Server-Sent Events)
   - **URL**: `http://ntfy-fetch:3000/mcp/sse` (Docker) or `http://localhost:3000/mcp/sse` (local)
   - **Description**: Notification management and scheduling

3. Save the configuration

### Claude Desktop Configuration (via MetaMCP)

Add to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "home-nas": {
      "command": "npx",
      "args": ["-y", "@metamcp/mcp-client"],
      "env": {
        "METAMCP_URL": "http://your-nas-ip:8765"
      }
    }
  }
}
```

MetaMCP will then expose all ntfy-fetch tools under the `ntfy` namespace.

## Direct MCP Connection (Without MetaMCP)

If you want to connect directly to ntfy-fetch's MCP endpoint without MetaMCP, you can use the MCP stdio client:

### Claude Desktop Configuration (Direct)

**Note**: Direct SSE connections from Claude Desktop are not currently supported. You'll need to use MetaMCP or another MCP gateway that supports SSE transport.

## Example Usage with Claude

Once configured, you can interact with ntfy-fetch using natural language:

- "List all my notification plugins"
- "Disable the tide notifications temporarily"
- "Show me what tasks are scheduled"
- "Schedule a reminder for tomorrow at 2 PM to check the weather"
- "What's the system status?"

## Troubleshooting

### MCP Endpoint Not Available

**Problem**: MCP endpoint returns 404

**Solution**: Ensure Web UI is enabled:
- Set `WEBUI=true` in your `.env` file or environment variables
- Restart ntfy-fetch

### Event Scheduler Tools Missing

**Problem**: `schedule_notification` and related tools not available

**Solution**: Enable the event scheduler:
- Set `USE_EVENT_SCHEDULER=true` in your environment
- Restart ntfy-fetch

### MetaMCP Cannot Connect

**Problem**: MetaMCP shows connection error

**Solution**:
1. Verify ntfy-fetch is running and Web UI is enabled
2. Check the URL is correct (use container name in Docker, localhost otherwise)
3. Ensure port 3000 is accessible from MetaMCP container
4. Check ntfy-fetch logs for connection attempts

## Architecture

```
Claude Desktop/AI Assistant
         ↓ (MCP protocol)
    MetaMCP Gateway
         ↓ (MCP SSE proxy)
ntfy-fetch:3000/mcp/sse
         ↓ (native MCP server)
  Plugin Manager / Event Scheduler
         ↓
    ntfy Notifications
```

## Benefits of Native MCP

1. **No Translation Overhead**: MetaMCP proxies the native MCP protocol without translation
2. **Full MCP Features**: Supports resources, tools, and future MCP capabilities
3. **Single Container**: No separate MCP server process needed
4. **Type-Safe**: Uses Zod schemas for parameter validation
5. **Embedded**: Runs in the same process as ntfy-fetch

## Development

### Adding New MCP Tools

1. Edit `src/mcp/server.ts`
2. Add tool definition to `ListToolsRequestSchema` handler
3. Add tool implementation to `CallToolRequestSchema` handler
4. Rebuild: `npm run build`

### Adding New MCP Resources

1. Edit `src/mcp/server.ts`
2. Add resource definition to `ListResourcesRequestSchema` handler
3. Add resource read implementation to `ReadResourceRequestSchema` handler
4. Rebuild: `npm run build`

## References

- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MetaMCP Documentation](https://github.com/metatool-ai/metamcp)
