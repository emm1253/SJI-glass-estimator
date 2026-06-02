FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173
ENV DATA_DIR=/app/data

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
COPY data/pricing.json ./data/pricing.json

RUN mkdir -p /app/data

EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
