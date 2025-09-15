# GitHub Container Registry Auto-Deployment Setup

This guide shows how to set up fully automated deployment using GitHub Container Registry (GHCR) - no local builds required!

## How It Works

1. **You push code** to GitHub
2. **GitHub Actions** automatically builds and pushes Docker image to GHCR
3. **Watchtower on TrueNAS** detects the new image and updates your container
4. **You get a notification** via ntfy when the update completes

## Prerequisites

1. GitHub repository (public or with package access)
2. GitHub Personal Access Token (PAT) with `read:packages` permission
3. TrueNAS with Docker/Container support

## Step 1: Create GitHub Personal Access Token

1. Go to https://github.com/settings/tokens/new
2. Give it a name like "TrueNAS GHCR Access"
3. Select expiration (or no expiration for permanent)
4. Select scope: `read:packages`
5. Click "Generate token" and save it

## Step 2: Make Your Package Public (Easier) or Configure Access

### Option A: Make Package Public (Recommended)
1. Go to https://github.com/mossly?tab=packages
2. Find `ntfy-fetch` package
3. Click on Package settings
4. Change visibility to Public

### Option B: Keep Private (Requires authentication)
Keep the PAT from Step 1 for Docker login

## Step 3: Deploy on TrueNAS

### Quick Setup (Using Script)
```bash
# SSH into TrueNAS
cd /tmp
git clone https://github.com/mossly/ntfy-fetch.git
cd ntfy-fetch
chmod +x deploy/setup-ghcr.sh
./deploy/setup-ghcr.sh
```

### Manual Setup
```bash
# 1. Authenticate with GHCR (if package is private)
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# 2. Create deployment directory
mkdir -p /mnt/Machina/apps/ntfy-fetch
cd /mnt/Machina/apps/ntfy-fetch

# 3. Create .env file
cat > .env << 'EOF'
NTFY_URL=https://ntfy.mossly.org
NTFY_TOPIC=your-topic
TZ=Pacific/Rarotonga
NOAA_STATION_ID=TPT2853
EOF

# 4. Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  ntfy-fetch:
    image: ghcr.io/mossly/ntfy-fetch:latest
    container_name: ntfy-fetch
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./data:/app/data
      - ./config:/app/config
    environment:
      - TZ=Pacific/Rarotonga
    labels:
      - "com.centurylinklabs.watchtower.enable=true"

  watchtower:
    image: containrrr/watchtower
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_POLL_INTERVAL=300
      - WATCHTOWER_LABEL_ENABLE=true
      - WATCHTOWER_NOTIFICATIONS=shoutrrr
      - WATCHTOWER_NOTIFICATION_URL=generic+http://ntfy.mossly.org/watchtower
    command: --interval 300 --cleanup --label-enable
EOF

# 5. Start services
docker-compose up -d
```

## Step 4: Verify Setup

```bash
# Check containers are running
docker ps

# Check Watchtower can see the container
docker logs watchtower | grep ntfy-fetch

# Test that updates work (force check)
docker exec watchtower kill -USR1 1
```

## Workflow

After setup, your workflow becomes:

1. **Make changes locally**
   ```bash
   git add .
   git commit -m "Your changes"
   git push origin master
   ```

2. **GitHub Actions automatically:**
   - Builds Docker image
   - Pushes to ghcr.io/mossly/ntfy-fetch:latest

3. **Watchtower automatically (within 5 minutes):**
   - Detects new image
   - Pulls new image
   - Stops old container
   - Starts new container
   - Cleans up old image
   - Sends notification to ntfy

4. **You receive notification** that deployment is complete!

## Monitoring

### Check GitHub Actions Build
https://github.com/mossly/ntfy-fetch/actions

### Check Package Versions
https://github.com/mossly/ntfy-fetch/pkgs/container/ntfy-fetch

### Check Watchtower Logs
```bash
docker logs watchtower -f
```

### Check Application Logs
```bash
docker logs ntfy-fetch -f
```

## Troubleshooting

### Watchtower not updating
- Check if package is public or you're authenticated
- Verify with: `docker pull ghcr.io/mossly/ntfy-fetch:latest`
- Check Watchtower logs: `docker logs watchtower`

### GitHub Actions failing
- Check Actions tab in GitHub
- Ensure repository has Actions enabled
- Check workflow file exists: `.github/workflows/docker-publish.yml`

### Authentication issues
```bash
# Re-authenticate
docker logout ghcr.io
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USER --password-stdin
```

### Force immediate update
```bash
# Send SIGUSR1 to Watchtower to trigger immediate check
docker exec watchtower kill -USR1 1
```

## Security Notes

- GitHub PAT is only needed if package is private
- For public packages, no authentication required on TrueNAS
- Watchtower runs with Docker socket access (required for updates)
- Consider using read-only token with minimal permissions

## Benefits

✅ **No manual builds** - GitHub Actions handles building
✅ **No manual deployment** - Watchtower handles updates
✅ **Multi-architecture** - Builds for amd64 and arm64
✅ **Automatic cleanup** - Old images are removed
✅ **Notifications** - Get notified when updates complete
✅ **Version history** - All versions stored in GHCR
✅ **Rollback capable** - Can pin to specific version if needed