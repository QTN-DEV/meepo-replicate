# ===== Stage 1: Build =====
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# ===== Stage 2: Runtime =====
FROM node:20-alpine

WORKDIR /app

# Copy only necessary runtime files
COPY --from=build /app /app

# Expose the port your server uses (default 3000)
EXPOSE 3000

# Environment variable (optional)
ENV NODE_ENV=production

# Start the app
CMD ["node", "server.js"]
