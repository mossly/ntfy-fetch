FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including dev dependencies for building)
RUN npm ci --silent

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

FROM node:18-alpine AS runtime

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S ntfy-fetch -u 1001

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production --silent && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create necessary directories and set permissions
RUN mkdir -p data config plugins && \
    chown -R ntfy-fetch:nodejs /app

# Switch to non-root user
USER ntfy-fetch

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); \
        const options = { hostname: 'localhost', port: 3000, path: '/health', timeout: 2000 }; \
        const req = http.request(options, (res) => process.exit(res.statusCode === 200 ? 0 : 1)); \
        req.on('error', () => process.exit(1)); \
        req.end();" || exit 1

# Set environment variables
ENV NODE_ENV=production
ENV TZ=Pacific/Rarotonga

# Expose port (if you add a health endpoint later)
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]