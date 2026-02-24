FROM node:20-alpine

WORKDIR /app

# Install dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy built app
COPY dist ./dist
COPY prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Create directories
RUN mkdir -p logs /data

# Environment
ENV NODE_ENV=production
ENV SOLAIRE_HOME=/data

EXPOSE 7777

CMD ["node", "dist/index.js"]
