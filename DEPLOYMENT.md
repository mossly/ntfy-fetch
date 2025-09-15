# TrueNAS Deployment Guide

This guide covers deploying ntfy-fetch on TrueNAS Scale using Docker containers.

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)
```bash
# Clone the repository
git clone https://github.com/your-username/ntfy-fetch.git
cd ntfy-fetch

# Copy and configure environment
cp .env.example .env
# Edit .env with your ntfy server details (URL, credentials, etc.)

# Start the service
docker compose up -d
```

### Option 2: TrueNAS Apps (Custom App)
1. Navigate to **Apps** → **Discover Apps** → **Custom App**
2. Use the configuration below

## 🔧 TrueNAS Custom App Configuration

### Application Configuration
- **Application Name**: `ntfy-fetch`
- **Version**: `1.0.0`
- **Container Repository**: `ghcr.io/your-username/ntfy-fetch` (or local build)
- **Container Tag**: `latest`
- **Restart Policy**: `Unless Stopped`

### Container Environment Variables
```yaml
Environment Variables:
- NTFY_URL: "https://ntfy.mossly.org"
- NTFY_TOPIC: "alerts"
- NTFY_USERNAME: "your-username"
- NTFY_PASSWORD: "your-password"
- NODE_ENV: "production"
- LOG_LEVEL: "info"
- TZ: "Pacific/Rarotonga"
- NOAA_STATION_ID: "TPT2853"
- NOAA_APPLICATION_NAME: "ntfy-fetch"
- CACHE_TTL_HOURS: "24"
- DATA_REFRESH_INTERVAL: "6"
```

### Storage Configuration
Create these Host Path volumes:
- **Config**: `/mnt/pool/apps/ntfy-fetch/config` → `/app/config`
- **Data**: `/mnt/pool/apps/ntfy-fetch/data` → `/app/data`
- **Plugins** (optional): `/mnt/pool/apps/ntfy-fetch/plugins` → `/app/plugins`

### Networking
- **Networking Type**: `Host Network` (or bridge with no ports needed)

## 🐳 Building Custom Docker Image

If you want to build and push your own image:

```bash
# Build the image
docker build -t ntfy-fetch:latest .

# Tag for registry
docker tag ntfy-fetch:latest ghcr.io/your-username/ntfy-fetch:latest

# Push to GitHub Container Registry
docker push ghcr.io/your-username/ntfy-fetch:latest
```

## 📁 Directory Structure on TrueNAS

```
/mnt/pool/apps/ntfy-fetch/
├── config/
│   └── plugins.json          # Optional custom plugin config
├── data/
│   ├── noaa-tide-data.json  # Cached NOAA API data
│   ├── combined.log         # Application logs
│   └── error.log           # Error logs
└── plugins/                 # Optional custom plugins
```

## 🔍 Monitoring & Logs

### Check Container Status
```bash
docker ps | grep ntfy-fetch
```

### View Logs
```bash
docker logs ntfy-fetch -f
```

### Test Notification
```bash
docker exec ntfy-fetch node dist/index.js test
```

## ⚙️ Configuration Options

### Custom Plugin Configuration
Create `/mnt/pool/apps/ntfy-fetch/config/plugins.json`:

```json
[
  {
    "name": "tide",
    "enabled": true,
    "provider": "noaa",
    "config": {
      "station": "TPT2853",
      "location": "Arorangi, Rarotonga",
      "timezone": "Pacific/Rarotonga",
      "notifications": {
        "highTide": {
          "enabled": true,
          "priority": "default"
        },
        "lowTide": {
          "enabled": true
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

## 🛠️ Troubleshooting

### Common Issues

**Container won't start:**
- Check environment variables are set
- Verify TrueNAS can access the internet for NOAA API
- Check volume mounts exist and have correct permissions

**No notifications received:**
- Test ntfy connection: `curl -d "test" YOUR_NTFY_URL/YOUR_TOPIC`
- Check container logs for authentication errors
- Verify NTFY_URL doesn't have trailing slash

**Timezone issues:**
- Ensure TZ environment variable is set to `Pacific/Rarotonga`
- Check that your system timezone doesn't interfere

**NOAA API errors:**
- Station TPT2853 is for Avarua, Rarotonga - ensure it's the correct station
- API may have temporary outages - check cached data in `/app/data/`

### Health Check
The container includes a health check. Check with:
```bash
docker inspect ntfy-fetch | grep -A 10 "Health"
```

## 🔄 Automatic Deployment

### Option 1: Watchtower (Recommended)
Automatically updates containers when new images are available.

```bash
# Deploy with Watchtower
cd /mnt/pool/apps/ntfy-fetch
docker-compose -f docker-compose.watchtower.yml up -d
```

Watchtower will:
- Check for updates every 5 minutes
- Automatically pull and redeploy changed images
- Send notifications to ntfy about updates
- Clean up old images

### Option 2: Cron Job
Add to TrueNAS **System Settings** → **Advanced** → **Cron Jobs**:

```bash
# Schedule: */30 * * * * (every 30 minutes)
# Command:
cd /mnt/pool/apps/ntfy-fetch && git pull && docker-compose build && docker-compose up -d
```

### Option 3: Manual Update with Script
```bash
# Make deployment script executable
chmod +x /mnt/pool/apps/ntfy-fetch/deploy/truenas-deploy.sh

# Run deployment
./deploy/truenas-deploy.sh
```

## 📝 Maintenance

### Update Application (Manual)
```bash
# Pull latest code
cd /mnt/pool/apps/ntfy-fetch
git pull origin master

# Rebuild and restart
docker-compose build
docker-compose down
docker-compose up -d
```

### Backup Configuration
Backup these directories:
- `/mnt/pool/apps/ntfy-fetch/config/` - Custom configurations
- `/mnt/pool/apps/ntfy-fetch/plugins/` - Custom plugins (if any)

Data directory can be recreated automatically from NOAA API.

## 🔐 Security Notes

- Store sensitive credentials in TrueNAS environment variables, not in files
- Use TrueNAS secrets management if available
- Keep the container updated for security patches
- Consider using ntfy authentication tokens instead of passwords

## 📞 Support

- Check logs first: `docker logs ntfy-fetch`
- Test individual components: `docker exec ntfy-fetch node dist/index.js test`
- Verify ntfy server connectivity outside the container
- Review NOAA station status: https://tidesandcurrents.noaa.gov/stationhome.html?id=TPT2853