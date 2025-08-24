# Albion Aegis - Railway Deployment Guide

This guide will help you deploy Albion Aegis to Railway with all necessary services and infrastructure.

## 🚀 Quick Start

### 1. **Prerequisites**
- [ ] Railway account (https://railway.app)
- [ ] GitHub repository with your code
- [ ] Supabase/Neon PostgreSQL database
- [ ] Upstash/Redis Cloud Redis instance

### 2. **Railway Project Setup**

#### **Step 1: Create Railway Project**
1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your `albion-aegis` repository
5. Name your project: `albion-aegis`

#### **Step 2: Add PostgreSQL Database**
1. In your Railway project, click "New Service"
2. Select "Database" → "PostgreSQL"
3. Name it: `albion-postgres`
4. Wait for it to be created
5. Copy the `DATABASE_URL` from the "Connect" tab

#### **Step 3: Add Redis Database**
1. Click "New Service" again
2. Select "Database" → "Redis"
3. Name it: `albion-redis`
4. Wait for it to be created
5. Copy the `REDIS_URL` from the "Connect" tab

### 3. **Deploy Application Services**

#### **Step 1: Deploy Scheduler Service**
1. Click "New Service" → "GitHub Repo"
2. Select your `albion-aegis` repository
3. Name it: `albion-scheduler`
4. Set the following environment variables:

```bash
# Required Environment Variables
NODE_ENV=production
DATABASE_URL=<your-postgres-url>
REDIS_URL=<your-redis-url>
API_BASE_URL=https://api-next.albionbb.com/us
USER_AGENT=albion-analytics-bot/1.0 (contact: your@email.com)

# Optional Configuration
RATE_MAX_RPS=4
CRAWL_INTERVAL_SEC=45
MAX_PAGES_PER_CRAWL=8
SOFT_LOOKBACK_MIN=180
KILLS_WORKER_CONCURRENCY=3
DEBOUNCE_KILLS_MIN=10
RECHECK_DONE_BATTLE_HOURS=2

# Deep Sweep Configuration
DEEP_SWEEP_HOURLY_PAGES=25
DEEP_SWEEP_HOURLY_LOOKBACK_H=12
DEEP_SWEEP_HOURLY_SLEEP_MS=60000
NIGHTLY_SWEEP_PAGES=50
NIGHTLY_SWEEP_LOOKBACK_H=24
NIGHTLY_SWEEP_SLEEP_MS=90000
```

5. Set the start command: `node dist/apps/scheduler.js`
6. Deploy the service

#### **Step 2: Deploy Kills Worker Service**
1. Click "New Service" → "GitHub Repo"
2. Select your `albion-aegis` repository
3. Name it: `albion-kills`
4. Use the same environment variables as scheduler
5. Set the start command: `node dist/apps/kills-worker.js`
6. Deploy the service

#### **Step 3: Deploy Metrics Service**
1. Click "New Service" → "GitHub Repo"
2. Select your `albion-aegis` repository
3. Name it: `albion-metrics`
4. Use the same environment variables as scheduler
5. Add: `PORT=8080`
6. Set the start command: `node dist/apps/metrics-http.js`
7. Deploy the service

### 4. **Database Migration**

#### **Step 1: Run Migrations**
1. Go to your `albion-scheduler` service
2. Click on "Deployments" tab
3. Click "Deploy" to trigger a new deployment
4. In the deployment logs, you should see Prisma migrations running

#### **Step 2: Verify Database Setup**
1. Go to your PostgreSQL service
2. Click "Query" tab
3. Run this query to verify tables exist:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';
```

You should see: `Battle`, `KillEvent`, `ServiceState`

### 5. **Service Verification**

#### **Check Service Status**
1. Go to each service and check the "Deployments" tab
2. Verify all services show "Deployed" status
3. Check logs for any errors

#### **Test Health Endpoints**
1. Go to your `albion-metrics` service
2. Click on the generated domain (e.g., `https://albion-metrics-production.up.railway.app`)
3. You should see the metrics server running
4. Test health check: `https://your-domain/healthz`
5. Test metrics: `https://your-domain/metrics`

### 6. **Monitoring Setup**

#### **Railway Monitoring**
- Each service has built-in monitoring
- Check "Metrics" tab for CPU, memory, and network usage
- Check "Logs" tab for real-time logs

#### **Custom Monitoring**
- Metrics endpoint: `https://your-metrics-domain/metrics`
- Health check: `https://your-metrics-domain/healthz`

### 7. **Environment Variables Reference**

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
REDIS_URL=rediss://:password@host:port
API_BASE_URL=https://api-next.albionbb.com/us
USER_AGENT=albion-analytics-bot/1.0 (contact: your@email.com)

# API Configuration
RATE_MAX_RPS=4
CRAWL_INTERVAL_SEC=45
MAX_PAGES_PER_CRAWL=8
SOFT_LOOKBACK_MIN=180

# Worker Configuration
KILLS_WORKER_CONCURRENCY=3
DEBOUNCE_KILLS_MIN=10
RECHECK_DONE_BATTLE_HOURS=2

# Deep Sweep Configuration
DEEP_SWEEP_HOURLY_PAGES=25
DEEP_SWEEP_HOURLY_LOOKBACK_H=12
DEEP_SWEEP_HOURLY_SLEEP_MS=60000
NIGHTLY_SWEEP_PAGES=50
NIGHTLY_SWEEP_LOOKBACK_H=24
NIGHTLY_SWEEP_SLEEP_MS=90000

# Metrics Service
PORT=8080
```

## 🔧 Troubleshooting

### **Common Issues**

#### **1. Database Connection Errors**
- Verify `DATABASE_URL` is correct
- Check if PostgreSQL service is running
- Ensure SSL is enabled in connection string

#### **2. Redis Connection Errors**
- Verify `REDIS_URL` is correct
- Check if Redis service is running
- Ensure authentication is properly configured

#### **3. Build Failures**
- Check build logs for TypeScript errors
- Verify all dependencies are in `package.json`
- Ensure Dockerfile is correct

#### **4. Service Not Starting**
- Check start commands are correct
- Verify environment variables are set
- Check logs for missing dependencies

### **Useful Commands**

```bash
# Check service logs
railway logs

# View service status
railway status

# Redeploy service
railway up

# Check environment variables
railway variables
```

## 📊 Monitoring & Alerts

### **Railway Built-in Monitoring**
- CPU and memory usage
- Network traffic
- Deployment status
- Error logs

### **Custom Metrics**
- API request rates
- Database operations
- Queue processing
- Rate limiting events

### **Health Checks**
- Service availability
- Database connectivity
- Redis connectivity
- API responsiveness

## 🔄 Scaling

### **Horizontal Scaling**
- Railway automatically scales based on traffic
- You can manually scale services in the dashboard
- Each service can be scaled independently

### **Resource Limits**
- Monitor resource usage in Railway dashboard
- Adjust service limits as needed
- Consider upgrading plans for higher limits

## 🚨 Emergency Procedures

### **Service Recovery**
1. Go to Railway dashboard
2. Select the failing service
3. Click "Redeploy" to restart
4. Check logs for errors

### **Database Issues**
1. Check PostgreSQL service status
2. Verify connection strings
3. Run database health checks
4. Contact Railway support if needed

### **Data Recovery**
1. Check Railway backups
2. Restore from backup if needed
3. Reset watermark if necessary
4. Run backfill for missing data

## 📞 Support

### **Railway Support**
- [Railway Documentation](https://docs.railway.app/)
- [Railway Discord](https://discord.gg/railway)
- [Railway Status](https://status.railway.app/)

### **Application Support**
- Check logs in Railway dashboard
- Monitor metrics endpoint
- Review deployment status
- Contact development team

---

**Albion Aegis** - Successfully deployed on Railway! ⚔️
