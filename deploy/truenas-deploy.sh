#!/bin/bash
# TrueNAS Auto-deployment Script
# This script pulls the latest code and rebuilds the container

set -e

# Configuration
PROJECT_DIR="/mnt/Machina/apps/ntfy-fetch"
COMPOSE_FILE="docker-compose.yml"
CONTAINER_NAME="ntfy-fetch"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting ntfy-fetch deployment...${NC}"

# Navigate to project directory
cd "$PROJECT_DIR"

# Pull latest changes from git
echo -e "${YELLOW}Pulling latest code...${NC}"
git pull origin master

# Build new image
echo -e "${YELLOW}Building Docker image...${NC}"
docker-compose build

# Stop and remove old container
echo -e "${YELLOW}Stopping old container...${NC}"
docker-compose down

# Start new container
echo -e "${YELLOW}Starting new container...${NC}"
docker-compose up -d

# Show container status
echo -e "${GREEN}Deployment complete! Container status:${NC}"
docker ps | grep $CONTAINER_NAME

# Show recent logs
echo -e "${YELLOW}Recent logs:${NC}"
docker logs --tail 20 $CONTAINER_NAME

echo -e "${GREEN}Deployment successful!${NC}"