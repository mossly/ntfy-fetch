#!/bin/bash

# Simple deployment script for ntfy-fetch on TrueNAS
# This handles everything in one place

set -e  # Exit on error

echo "🚀 Deploying ntfy-fetch with event scheduler..."

# Check if we're in the right directory
if [ ! -f "docker-compose.production.yml" ]; then
    echo "❌ Error: docker-compose.production.yml not found!"
    echo "Please run this script from the ntfy-fetch directory"
    exit 1
fi

# Check for .env file
if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found!"
    echo "Creating template .env file..."
    cat > .env << 'EOF'
# Required Configuration
NTFY_URL=http://localhost:8080
NTFY_TOPIC=tide-alerts

# Optional: NOAA Station (default: TPT2853 for Rarotonga)
NOAA_STATION_ID=TPT2853

# Optional: ntfy authentication
# NTFY_USERNAME=
# NTFY_PASSWORD=

# Event Scheduler (set to true for precise notifications)
USE_EVENT_SCHEDULER=true
EOF
    echo "✅ Created .env template - please edit with your settings"
    exit 1
fi

# Stop existing containers
echo "📦 Stopping existing containers..."
docker compose -f docker-compose.production.yml down 2>/dev/null || true

# Pull latest images
echo "📥 Pulling latest images..."
docker compose -f docker-compose.production.yml pull

# Start services
echo "🔧 Starting services..."
docker compose -f docker-compose.production.yml up -d

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 5

# Check if services are running
if docker ps | grep -q ntfy-fetch; then
    echo "✅ ntfy-fetch is running"

    # Show scheduler status
    echo ""
    echo "📊 Event Scheduler Status:"
    docker exec ntfy-fetch node dist/index.js status 2>/dev/null | grep -A 10 "eventScheduler" || echo "Status check not available yet"

    # Show logs
    echo ""
    echo "📝 Recent logs:"
    docker logs --tail 20 ntfy-fetch

    echo ""
    echo "✨ Deployment complete!"
    echo ""
    echo "📌 Useful commands:"
    echo "  View logs:        docker logs -f ntfy-fetch"
    echo "  Check status:     docker exec ntfy-fetch node dist/index.js status"
    echo "  View events:      docker exec ntfy-fetch cat /app/data/scheduled-events.json | jq"
    echo "  Restart:          docker compose -f docker-compose.production.yml restart"
    echo "  Stop:             docker compose -f docker-compose.production.yml down"
else
    echo "❌ Failed to start ntfy-fetch"
    docker logs ntfy-fetch
    exit 1
fi