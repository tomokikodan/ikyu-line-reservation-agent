FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

CMD ["sh", "-c", "npm run migrate && npm run start"]
