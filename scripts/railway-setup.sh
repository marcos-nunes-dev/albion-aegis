#!/bin/bash

# Railway Setup Script for Albion Aegis
# This script helps you set up the Railway deployment

echo "🚀 Albion Aegis Railway Setup"
echo "=============================="

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Please install it first:"
    echo "npm install -g @railway/cli"
    echo "railway login"
    exit 1
fi

echo "✅ Railway CLI found"

# Check if user is logged in
if ! railway whoami &> /dev/null; then
    echo "❌ Not logged in to Railway. Please run:"
    echo "railway login"
    exit 1
fi

echo "✅ Logged in to Railway"

# Create project if it doesn't exist
echo "📦 Creating Railway project..."
railway init --name albion-aegis

# Add PostgreSQL database
echo "🗄️ Adding PostgreSQL database..."
railway add

# Add Redis database
echo "🔴 Adding Redis database..."
railway add

# Deploy the application
echo "🚀 Deploying application..."
railway up

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Go to Railway dashboard"
echo "2. Set environment variables for each service"
echo "3. Check deployment logs"
echo "4. Verify services are running"
echo ""
echo "For detailed instructions, see: RAILWAY_DEPLOYMENT.md"
