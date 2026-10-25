# syntax=docker/dockerfile:1

# Node 22+ has a built-in WebSocket, so yapin.js uses the gateway instead of polling.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so code changes don't reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# The app files stay read-only to the bot. Only data/ (settings, seen versions, the event cursor) is writable.
RUN mkdir -p data && chown node:node data
USER node
VOLUME ["/app/data"]

CMD ["node", "bot.js"]
