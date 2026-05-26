# Use Node.js base image
FROM node:20-slim

# Install LibreOffice and other dependencies for PDF/image processing
RUN apt-get update && apt-get install -y \
    libreoffice \
    libreoffice-writer \
    libreoffice-impress \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Expose port 3000
EXPOSE 3000

# Start Express server
CMD ["npm", "start"]
