FROM node:24-alpine
ENV NODE_ENV=production PORT=4242 DATABASE_PATH=/app/data/payments.sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir /app/data && chown node:node /app/data
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
USER node
EXPOSE 4242
VOLUME ["/app/data"]
CMD ["node", "src/server.js"]
