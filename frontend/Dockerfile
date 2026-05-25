FROM node:20.19-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the Vite app (compiles to the /app/dist folder)
RUN npm run build
