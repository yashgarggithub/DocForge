FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5050

COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public

RUN mkdir -p data/sessions && chown -R node:node /app
USER node

EXPOSE 5050
CMD ["npm", "start"]
