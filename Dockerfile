FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
