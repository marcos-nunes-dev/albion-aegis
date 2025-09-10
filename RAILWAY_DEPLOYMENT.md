# Railway Deployment Guide for Albion Aegis BFF

This guide explains how to deploy the BFF service to Railway alongside your existing services.

## 🚀 Quick Deploy

### Option 1: Deploy from GitHub (Recommended)

1. **Go to [Railway Dashboard](https://railway.app/dashboard)**
2. **Click "New Project"**
3. **Select "Deploy from GitHub repo"**
4. **Choose your `albion-aegis` repository**
5. **Select the branch you want to deploy (usually `main`)**
6. **Railway will automatically detect it's a Node.js project**

### Option 2: Deploy from CLI

```bash
# Install Railway CLI if you haven't already
npm install -g @railway/cli

# Login to Railway
railway login

# Link to your project
railway link

# Deploy
railway up
```

## ⚙️ Configuration

### Required Environment Variables

Set these in your Railway project dashboard:

```bash
# Database (use the same as your other services)
DATABASE_URL=postgresql://user:password@host:port/database

# BFF Configuration
BFF_PORT=3001
BFF_ALLOWED_ORIGINS=https://your-frontend-domain.com,http://localhost:3000

# Other required variables (same as your existing services)
API_BASE_URL=https://api-next.albionbb.com/us
USER_AGENT=albion-analytics-bot/1.0
REDIS_URL=your-redis-url
NODE_ENV=production
```

### Optional Environment Variables

```bash
# Database Pool Configuration
DATABASE_POOL_MIN=3
DATABASE_POOL_MAX=20
DATABASE_CONNECTION_TIMEOUT=30000
DATABASE_IDLE_TIMEOUT=60000

# Rate Limiting
RATE_MAX_RPS=8
```

## 🐳 Docker Configuration

Railway will automatically use your existing `Dockerfile` and build the BFF service. The service will be built using:

```dockerfile
# Railway will use your existing Dockerfile
# Build command: npm run build
# Start command: node dist/apps/api-bff/src/server.js
```

## 🔗 Service Integration

### Connect to Existing Database

1. **In Railway Dashboard, go to your BFF service**
2. **Click "Variables" tab**
3. **Add `DATABASE_URL` variable**
4. **Use the same database URL as your other services**

### Connect to Existing Redis (Optional)

1. **Add `REDIS_URL` variable**
2. **Use the same Redis URL as your other services**

## 📊 Monitoring & Health Checks

### Health Check Endpoint

Railway will automatically monitor:
- **Health Check Path**: `/health`
- **Health Check Timeout**: 300 seconds
- **Restart Policy**: On failure with max 10 retries

### Logs

View logs in Railway Dashboard:
1. **Go to your BFF service**
2. **Click "Deployments" tab**
3. **Click on latest deployment**
4. **View logs in real-time**

## 🚀 Deployment Steps

### 1. Initial Setup

```bash
# Clone your repository (if not already done)
git clone https://github.com/yourusername/albion-aegis.git
cd albion-aegis

# Ensure you're on the right branch
git checkout main
```

### 2. Deploy to Railway

```bash
# Deploy using Railway CLI
railway up

# Or deploy from GitHub dashboard
# (Go to Railway Dashboard → New Project → GitHub)
```

### 3. Configure Environment Variables

1. **Set `DATABASE_URL`** (same as your other services)
2. **Set `BFF_ALLOWED_ORIGINS`** (your frontend domains)
3. **Set other required variables**

### 4. Test Deployment

```bash
# Get your Railway service URL
railway status

# Test health endpoint
curl https://your-service-url.railway.app/health

# Test tRPC endpoint
curl https://your-service-url.railway.app/
```

## 🔒 Security Considerations

### CORS Configuration

```bash
# Set BFF_ALLOWED_ORIGINS to only your frontend domains
BFF_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### Database Security

- Use the same secure database connection as your other services
- Ensure database is not publicly accessible
- Use connection pooling for production

## 📈 Scaling

### Automatic Scaling

Railway will automatically:
- Scale based on traffic
- Restart failed services
- Handle health checks

### Manual Scaling

```bash
# Scale up/down using CLI
railway scale 2

# Or use Railway Dashboard
# (Go to service → Settings → Scale)
```

## 🐛 Troubleshooting

### Common Issues

1. **Build Failures**
   ```bash
   # Check build logs in Railway Dashboard
   # Ensure all dependencies are in package.json
   ```

2. **Database Connection Issues**
   ```bash
   # Verify DATABASE_URL is correct
   # Check if database is accessible from Railway
   ```

3. **Port Issues**
   ```bash
   # Railway sets PORT automatically
   # Use BFF_PORT=3001 for internal configuration
   ```

### Debug Commands

```bash
# View service logs
railway logs

# Check service status
railway status

# View environment variables
railway variables
```

## 🔄 Updates & Redeployment

### Automatic Deployments

Railway will automatically redeploy when you:
- Push to your main branch
- Create a new release tag

### Manual Redeployment

```bash
# Redeploy current code
railway up

# Or trigger from GitHub
# (Push to main branch)
```

## 📚 Next Steps

After successful deployment:

1. **Test all endpoints** using the test script
2. **Configure your frontend** to use the BFF URL
3. **Set up monitoring** and alerting
4. **Configure custom domain** if needed

## 🆘 Support

- **Railway Documentation**: [docs.railway.app](https://docs.railway.app/)
- **Railway Discord**: [discord.gg/railway](https://discord.gg/railway)
- **Project Issues**: [GitHub Issues](https://github.com/yourusername/albion-aegis/issues)
