#!/bin/bash

# Docker test script for Albion Aegis
# This script helps test the Docker setup

set -e

echo "🐳 Testing Albion Aegis Docker Setup"
echo "====================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop or Docker daemon."
    exit 1
fi

echo "✅ Docker is running"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from template..."
    cp .env.example .env
    echo "📝 Please edit .env file with your real credentials before continuing"
    echo "   Required: DATABASE_URL and REDIS_URL"
    exit 1
fi

echo "✅ .env file found"

# Build the Docker image
echo "🔨 Building Docker image..."
docker build -t albion-ingestor .

echo "✅ Docker image built successfully"

# Test the image
echo "🧪 Testing Docker image..."
docker run --rm --env-file .env albion-ingestor:latest node dist/index.js

echo "✅ Docker image test passed"

echo ""
echo "🚀 Ready to run with docker-compose!"
echo "   Run: docker compose up --build"
echo ""
echo "📖 See README.md for detailed instructions"
