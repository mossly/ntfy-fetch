#!/bin/bash
# Setup script for GitHub Container Registry authentication on TrueNAS

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== GitHub Container Registry Setup for ntfy-fetch ===${NC}"
echo ""

# Check if running on TrueNAS
if [ ! -d "/mnt" ]; then
    echo -e "${YELLOW}Warning: This script is designed for TrueNAS. Adjust paths if needed.${NC}"
fi

# Get GitHub Personal Access Token
echo -e "${GREEN}Step 1: GitHub Authentication${NC}"
echo "You need a GitHub Personal Access Token (PAT) with 'read:packages' permission."
echo "Create one at: https://github.com/settings/tokens/new"
echo ""
read -p "Enter your GitHub username: " GITHUB_USER
read -s -p "Enter your GitHub Personal Access Token: " GITHUB_TOKEN
echo ""

# Test authentication
echo -e "${YELLOW}Testing GitHub authentication...${NC}"
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USER --password-stdin

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Successfully authenticated with GitHub Container Registry${NC}"
else
    echo -e "${RED}✗ Authentication failed. Please check your credentials.${NC}"
    exit 1
fi

# Pull the latest image
echo -e "${YELLOW}Pulling latest image...${NC}"
docker pull ghcr.io/mossly/ntfy-fetch:latest

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Successfully pulled the latest image${NC}"
else
    echo -e "${RED}✗ Failed to pull image. The repository might be private.${NC}"
    echo "Make sure the package is set to public or you have the correct permissions."
    exit 1
fi

# Create deployment directory if it doesn't exist
DEPLOY_DIR="/mnt/Machina/apps/ntfy-fetch"
if [ -d "$DEPLOY_DIR" ]; then
    echo -e "${GREEN}Using existing deployment directory: $DEPLOY_DIR${NC}"
else
    echo -e "${YELLOW}Creating deployment directory: $DEPLOY_DIR${NC}"
    mkdir -p "$DEPLOY_DIR"
    mkdir -p "$DEPLOY_DIR/data"
    mkdir -p "$DEPLOY_DIR/config"
fi

# Copy docker-compose file
echo -e "${YELLOW}Setting up docker-compose...${NC}"
if [ -f "docker-compose.ghcr.yml" ]; then
    cp docker-compose.ghcr.yml "$DEPLOY_DIR/docker-compose.yml"
    echo -e "${GREEN}✓ Copied docker-compose.yml${NC}"
fi

# Check for .env file
if [ ! -f "$DEPLOY_DIR/.env" ]; then
    echo -e "${YELLOW}No .env file found. Creating template...${NC}"
    cat > "$DEPLOY_DIR/.env" << 'EOF'
# ntfy Configuration
NTFY_URL=https://ntfy.mossly.org
NTFY_TOPIC=your-topic-here
# NTFY_USERNAME=optional
# NTFY_PASSWORD=optional

# NOAA Configuration
NOAA_STATION_ID=TPT2853
TZ=Pacific/Rarotonga

# Optional Settings
LOG_LEVEL=info
CACHE_TTL_HOURS=24
DATA_REFRESH_INTERVAL=6
EOF
    echo -e "${RED}⚠ Please edit $DEPLOY_DIR/.env with your ntfy credentials${NC}"
fi

echo ""
echo -e "${GREEN}=== Setup Complete ===${NC}"
echo ""
echo "Next steps:"
echo "1. Edit the .env file if needed: $DEPLOY_DIR/.env"
echo "2. Start the service:"
echo "   cd $DEPLOY_DIR"
echo "   docker-compose up -d"
echo ""
echo "The container will automatically update when new versions are pushed to GitHub!"
echo ""
echo -e "${BLUE}Monitoring:${NC}"
echo "  docker logs ntfy-fetch -f     # View application logs"
echo "  docker logs watchtower -f     # View update logs"