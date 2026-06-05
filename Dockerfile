# NOTEtoolsLM v2 — Fleet Orchestrator
# Multi-stage Node.js 20 build

FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS release
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=base /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
