# ── Stage: Runtime ────────────────────────────────────────────
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package manifest first (layer caching)
COPY package.json ./

# Copy all source files
COPY task-cli.js  ./
COPY server.js    ./
COPY public/      ./public/

# Create a default tasks.json so the app works even without a volume mount
RUN echo '{"nextId":1,"tasks":[]}' > /app/tasks.json

# Expose the web server port
EXPOSE 3000

# Health check — ensure the server responds
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

# Start the web server
CMD ["node", "server.js"]
