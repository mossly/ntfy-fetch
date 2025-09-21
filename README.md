# ntfy-fetch

An extensible notification service for pushing alerts to your self-hosted ntfy instance. Built with a plugin architecture, currently featuring tide notifications for Avarua, Rarotonga using NOAA data.

## 🌊 Features

- **Extensible Plugin System**: Easy to add new notification types
- **Tide Notifications**: High/low tide alerts and daily summaries
- **NOAA Integration**: Official tide data from station TPT2853 (Avarua Harbor)
- **Timezone Aware**: Properly handles Cook Islands Time (UTC-10)
- **Smart Scheduling**: Advanced notification scheduling with duplicate prevention
- **Self-Hosted**: Runs alongside your ntfy server on your infrastructure
- **Docker Ready**: Complete containerization with docker-compose

## 🚀 Quick Start

### 1. Clone and Setup
```bash
git clone <your-repo>
cd ntfy-fetch
cp .env.example .env
```

### 2. Configure Environment
Edit `.env` with your settings:
```bash
NTFY_URL=http://your-nas:8080
NTFY_TOPIC=tide-alerts
TZ=Pacific/Rarotonga
```

### 3. Run with Docker
```bash
# Start both ntfy server and notification service
docker-compose up -d

# Or just the notification service (if you already have ntfy)
docker-compose up -d ntfy-fetch
```

### 4. Development Mode
```bash
npm install
npm run dev
```

## 📋 Configuration

### Default Tide Plugin Settings
- **High/Low Tide Alerts**: Event notifications at exact tide times
- **Daily Summary**: 7:00 AM local time with upcoming tides
- **Location**: Avarua, Rarotonga
- **Data Source**: NOAA Station TPT2853
- **Duplicate Prevention**: Smart scheduling prevents repeated notifications

### Custom Plugin Configuration
Create `config/plugins.json`:
```json
[
  {
    "name": "tide",
    "enabled": true,
    "provider": "noaa",
    "config": {
      "station": "TPT2853",
      "location": "Arorangi, Rarotonga",
      "notifications": {
        "tideEvents": {
          "enabled": true,
          "priority": "default"
        },
        "dailySummary": {
          "enabled": true,
          "time": "07:00"
        }
      }
    }
  }
]
```

## 🔧 Commands

```bash
# Development
npm run dev              # Watch mode with auto-restart
npm run build           # Compile TypeScript
npm start               # Start production build
npm run type-check      # Type checking only

# Testing and Operations
node dist/index.js test # Run immediate test
node dist/index.js status # Show service status

# Docker
docker-compose up -d    # Start all services
docker-compose logs -f ntfy-fetch # View logs
```

## 🔌 Creating Custom Plugins

1. **Create Plugin Class**:
```typescript
import { BasePlugin } from './plugins/base/Plugin';

export class WeatherPlugin extends BasePlugin {
  getSchedules() {
    return [{
      expression: CronExpressionBuilder.everyHours(1), // Every hour
      description: 'Check weather conditions',
      enabled: this.enabled
    }];
  }

  async checkConditions(context?: { description?: string }) {
    // Your notification logic using scheduling utilities
    return [{
      title: 'Weather Alert',
      message: 'Storm approaching!',
      priority: 'high'
    }];
  }
}
```

2. **Register in PluginManager** (`src/core/PluginManager.ts`)
3. **Add Configuration** to `config/plugins.json`

## 📁 Project Structure

```
ntfy-fetch/
├── src/
│   ├── core/           # Scheduler, PluginManager, NotificationService
│   ├── plugins/
│   │   ├── base/       # Base classes
│   │   └── tide/       # Tide notification plugin
│   ├── utils/          # Logger, timezone helpers
│   └── config/         # Configuration management
├── data/               # Cache and persistent data
├── config/             # Plugin configurations
└── plugins/            # External plugins (optional)
```

## 🌐 NOAA API Details

- **Station**: TPT2853 (Avarua Harbor, Rarotonga)
- **Data Products**: High/Low tide predictions
- **Update Frequency**: Daily cache refresh
- **Timezone**: Data fetched in UTC, converted to Cook Islands Time

## 🐳 Docker Deployment

The service runs in a lightweight Alpine Linux container with:
- Non-root user for security
- Proper signal handling for graceful shutdowns
- Health checks for monitoring
- Volume mounts for persistent data

## 📊 Monitoring

- **Logs**: Check `docker-compose logs -f ntfy-fetch`
- **Health**: Service includes basic health checking
- **Status**: Use `node dist/index.js status` for service info

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with `npm run test`
5. Submit a pull request

## 📝 License

MIT License - feel free to use and modify for your own projects!