# PebbleTesla API server (public + private HTTP servers)
FROM node:22-alpine
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY index.js ./
COPY lib ./lib/
COPY scripts ./scripts/
RUN mkdir -p /data
ENV TOKEN_FILE=/data/tokens.json
WORKDIR /data
EXPOSE 8080 9000
CMD ["node", "/app/index.js"]
