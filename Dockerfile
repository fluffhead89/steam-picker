FROM node:24-alpine

WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3456 \
    DATA_DIR=/data

# Metadata cache and hidden-games list live here; mount a volume to keep them.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 3456
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3456/api/status >/dev/null || exit 1
CMD ["node", "server.js"]
