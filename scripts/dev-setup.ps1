# Development Environment Setup Script
# This script sets up the environment for local development with Docker Redis

Write-Host "Setting up Albion Aegis Development Environment..." -ForegroundColor Green

# Set environment variables for local development
$env:REDIS_URL = "redis://localhost:6379"
$env:NODE_ENV = "development"

Write-Host "Environment variables set:" -ForegroundColor Green
Write-Host "   REDIS_URL: $env:REDIS_URL" -ForegroundColor Cyan
Write-Host "   NODE_ENV: $env:NODE_ENV" -ForegroundColor Cyan

# Check if Redis is running
Write-Host "`nChecking Redis status..." -ForegroundColor Yellow
try {
    $redisStatus = docker exec albion-redis-local redis-cli ping 2>$null
    if ($redisStatus -eq "PONG") {
        Write-Host "Redis is running and accessible" -ForegroundColor Green
    } else {
        Write-Host "Redis is not responding correctly" -ForegroundColor Red
        Write-Host "Start Redis with: npm run redis:up" -ForegroundColor Yellow
    }
} catch {
    Write-Host "Redis container not found or not running" -ForegroundColor Red
    Write-Host "Start Redis with: npm run redis:up" -ForegroundColor Yellow
}

Write-Host "`nDevelopment environment ready!" -ForegroundColor Green
Write-Host "Available commands:" -ForegroundColor Cyan
Write-Host "   npm run crawl:once     - Test single crawl" -ForegroundColor White
Write-Host "   npm run start:scheduler - Start continuous crawling" -ForegroundColor White
Write-Host "   npm run start:kills     - Start kills worker" -ForegroundColor White
Write-Host "   npm run redis:up        - Start Redis" -ForegroundColor White
Write-Host "   npm run redis:down      - Stop Redis" -ForegroundColor White
