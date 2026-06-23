FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install --production

# Copy source
COPY . .

# Create logs directory
RUN mkdir -p logs

EXPOSE 3000

CMD ["node", "src/index.js"]
