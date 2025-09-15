# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ntfy-fetch is an extensible notification service that pushes alerts to self-hosted ntfy instances. It uses a plugin-based architecture to support different types of notifications, with the primary implementation being tide notifications using NOAA data for Avarua, Rarotonga (Station TPT2853).

## Common Development Commands

```bash
# Install dependencies
npm install

# Development
npm run dev          # Start with file watching
npm run build        # Compile TypeScript
npm start            # Start the built application
npm run type-check   # Type check without compilation
npm run lint         # Lint source code

# Docker deployment
docker-compose up -d           # Start with ntfy server
docker-compose up -d ntfy-fetch # Start only the notification service

# Testing and debugging
node dist/index.js test        # Run immediate test execution
node dist/index.js status      # Show service status
```

## Architecture

### Plugin System
- **Base Classes**: `BasePlugin` and `BaseDataProvider` in `src/plugins/base/`
- **Plugin Registration**: Plugins are registered in `PluginManager.createPlugin()`
- **Configuration**: Plugin configs in `config/plugins.json` or environment variables

### Core Components
- **Scheduler** (`src/core/Scheduler.ts`): Manages cron jobs using `node-cron`
- **PluginManager** (`src/core/PluginManager.ts`): Handles plugin lifecycle
- **NotificationService** (`src/core/NotificationService.ts`): Sends notifications to ntfy
- **ConfigManager** (`src/config/index.ts`): Loads and validates configuration

### Data Flow
1. Scheduler triggers plugin checks based on cron expressions
2. Plugins check conditions and return `NotificationData[]`
3. NotificationService sends notifications to ntfy server
4. Data providers cache responses to minimize API calls

## Key Configuration

### Environment Variables
- `NTFY_URL`: Your ntfy server URL (e.g., `http://localhost:8080`)
- `NTFY_TOPIC`: Topic name for notifications
- `NOAA_STATION_ID`: NOAA station ID (default: TPT2853 for Avarua)
- `TZ`: Timezone (default: Pacific/Rarotonga for UTC-10)

### Timezone Handling
- **Critical**: All NOAA API responses are in UTC
- **Conversion**: Use `TimezoneHelper` for UTC↔Cook Islands Time conversion
- **Scheduling**: Cron jobs run in local timezone (Pacific/Rarotonga)

## Creating New Plugins

1. **Create plugin class** extending `BasePlugin`
2. **Implement required methods**:
   - `getSchedules()`: Return cron schedule configurations
   - `checkConditions(context?)`: Return notifications to send (context includes schedule description)
   - `onInitialize()` / `onCleanup()`: Setup and teardown
3. **Register in PluginManager** in the `createPlugin()` method
4. **Add configuration** to `config/plugins.json`

### Example Plugin Structure
```typescript
import { NotificationScheduler, CronExpressionBuilder } from '../../utils/scheduling';

export class CustomPlugin extends BasePlugin {
  private scheduler: NotificationScheduler;

  constructor(config: PluginConfig) {
    super(config, metadata);
    this.scheduler = new NotificationScheduler('custom', 24);
  }

  getSchedules(): ScheduleConfig[] {
    return [{
      expression: CronExpressionBuilder.everyMinutes(10), // Every 10 minutes
      description: 'Check custom conditions',
      enabled: this.enabled
    }, {
      expression: CronExpressionBuilder.daily('09:00'), // Daily at 9 AM
      description: 'Send daily report',
      enabled: true
    }];
  }

  async checkConditions(context?: { description?: string }): Promise<NotificationData[]> {
    // Check which schedule triggered this
    if (context?.description?.includes('daily report')) {
      return this.handleDailyReport();
    }

    // Regular condition checks
    return this.handleRegularCheck();
  }
}
```

## Scheduling Utilities

The `src/utils/scheduling.ts` module provides reusable components for time-based notifications:

### NotificationScheduler
Manages notification tracking and prevents duplicate sends:
```typescript
const scheduler = new NotificationScheduler('plugin-name', 24);

// Check if daily summary should be sent
if (scheduler.shouldSendDailySummary({
  enabled: true,
  time: '07:00',
  windowMinutes: 5
})) {
  // Send notification
  scheduler.markDailySummaryAsSent();
}

// Check if event notification should be sent
if (scheduler.shouldSendEventNotification(eventId, eventTime, 2)) {
  // Notification will be automatically marked as sent
}
```

### CronExpressionBuilder
Helper for creating common cron patterns:
```typescript
CronExpressionBuilder.daily('07:00')        // Daily at 7 AM
CronExpressionBuilder.everyMinutes(5)       // Every 5 minutes
CronExpressionBuilder.everyHours(2)         // Every 2 hours
CronExpressionBuilder.weekly('10:00', [1,5]) // Mondays and Fridays at 10 AM
CronExpressionBuilder.monthly('09:00')      // First day of month at 9 AM
```

### ScheduleChecker
Low-level time checking utilities:
```typescript
// Check if within time window
ScheduleChecker.isWithinTimeWindow({ hour: 7, minute: 0 }, 5); // Within 5 minutes of 7:00

// Calculate minutes until event
ScheduleChecker.minutesUntil(targetDate);

// Generate daily tracking keys
ScheduleChecker.getDailyKey('summary'); // Returns 'summary-2025-01-14'
```

## NOAA API Integration

- **Station**: TPT2853 (Avarua Harbor, Rarotonga)
- **API Endpoint**: `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`
- **Data Products**: Use `product=predictions` with `interval=hilo` for tide times
- **Caching**: Responses cached for 24 hours to respect API limits
- **Rate Limits**: No explicit limits but use caching to be respectful

### Key NOAA Parameters
```typescript
{
  station: 'TPT2853',
  product: 'predictions',
  datum: 'MLLW',        // Mean Lower Low Water
  time_zone: 'gmt',     // Always fetch in GMT, convert locally
  units: 'metric',
  interval: 'hilo',     // High/Low predictions only
  format: 'json'
}
```

## Docker Deployment

- **Multi-stage build** for optimized production image
- **Non-root user** for security (user: ntfy-fetch, uid: 1001)
- **Signal handling** via dumb-init for graceful shutdowns
- **Volume mounts**:
  - `./data:/app/data` (cache and logs)
  - `./config:/app/config` (configuration files)
  - `./plugins:/app/plugins` (custom plugins)

## Development Notes

- **Logging**: Use the centralized logger from `src/utils/logger.ts`
- **Error Handling**: Plugins should handle errors gracefully and log them
- **Type Safety**: All interfaces defined in `src/types/index.ts`
- **Testing**: Use `npm run test` command for immediate execution testing

## File Structure
```
src/
├── core/                 # Core application logic
├── plugins/
│   ├── base/            # Base classes for plugins
│   └── tide/            # Tide notification plugin
├── utils/               # Utility functions (logging, timezone)
├── config/              # Configuration management
└── types/               # TypeScript type definitions
```

## Troubleshooting

- **NOAA API errors**: Check station ID and internet connectivity
- **Timezone issues**: Verify TZ environment variable is set to `Pacific/Rarotonga`
- **ntfy connection**: Test with `curl -d "test" YOUR_NTFY_URL/YOUR_TOPIC`
- **Plugin not loading**: Check plugin registration in PluginManager