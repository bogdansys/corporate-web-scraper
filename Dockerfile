# Multi-stage build for Veridion SWE Challenge API
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:20-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ ./dist/
COPY SampleData/ ./SampleData/
COPY output/ ./output/
EXPOSE 3000
CMD ["node", "dist/api/index.js"]
