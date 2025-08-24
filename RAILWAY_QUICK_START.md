# 🚀 Railway Quick Start Guide

## **5-Minute Setup for Albion Aegis on Railway**

### **Step 1: Prerequisites**
- [ ] Railway account: https://railway.app
- [ ] GitHub repository with your code
- [ ] Railway CLI: `npm install -g @railway/cli`

### **Step 2: Create Railway Project**
```bash
# Login to Railway
railway login

# Create project (if using CLI)
railway init --name albion-aegis
```

### **Step 3: Add Infrastructure Services**

#### **PostgreSQL Database**
1. Go to Railway Dashboard
2. Click "New Service" → "Database" → "PostgreSQL"
3. Name: `albion-postgres`
4. Copy the `DATABASE_URL`

#### **Redis Database**
1. Click "New Service" → "Database" → "Redis"
2. Name: `albion-redis`
3. Copy the `REDIS_URL`

### **Step 4: Deploy Application Services**

#### **Scheduler Service**
1. Click "New Service" → "GitHub Repo"
2. Select your repository
3. Name: `albion-scheduler`
4. Set environment variables (see below)
5. Start command: `node dist/apps/scheduler.js`

#### **Kills Worker Service**
1. Click "New Service" → "GitHub Repo"
2. Select your repository
3. Name: `albion-kills`
4. Same environment variables as scheduler
5. Start command: `node dist/apps/kills-worker.js`

#### **Metrics Service**
1. Click "New Service" → "GitHub Repo"
2. Select your repository
3. Name: `albion-metrics`
4. Same environment variables + `PORT=8080`
5. Start command: `node dist/apps/metrics-http.js`

### **Step 5: Environment Variables**

Copy these to each service's environment variables:

```bash
# Required
NODE_ENV=production
DATABASE_URL=<your-postgres-url>
REDIS_URL=<your-redis-url>
API_BASE_URL=https://api-next.albionbb.com/us
USER_AGENT=albion-analytics-bot/1.0 (contact: your@email.com)

# Optional (defaults are good)
RATE_MAX_RPS=4
CRAWL_INTERVAL_SEC=45
MAX_PAGES_PER_CRAWL=8
SOFT_LOOKBACK_MIN=180
KILLS_WORKER_CONCURRENCY=3
DEBOUNCE_KILLS_MIN=10
RECHECK_DONE_BATTLE_HOURS=2

# Deep Sweep
DEEP_SWEEP_HOURLY_PAGES=25
DEEP_SWEEP_HOURLY_LOOKBACK_H=12
DEEP_SWEEP_HOURLY_SLEEP_MS=60000
NIGHTLY_SWEEP_PAGES=50
NIGHTLY_SWEEP_LOOKBACK_H=24
NIGHTLY_SWEEP_SLEEP_MS=90000

# Metrics Service Only
PORT=8080
```

### **Step 6: Verify Deployment**

#### **Check Service Status**
- Go to each service in Railway dashboard
- Verify "Deployed" status
- Check logs for any errors

#### **Test Health Endpoints**
- Go to `albion-metrics` service
- Click the generated domain
- Test: `https://your-domain/healthz`
- Test: `https://your-domain/metrics`

#### **Verify Database**
- Go to PostgreSQL service
- Click "Query" tab
- Run: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`
- Should see: `Battle`, `KillEvent`, `ServiceState`

### **Step 7: Monitor & Scale**

#### **Railway Monitoring**
- Each service has built-in metrics
- Check CPU, memory, network usage
- Monitor logs for errors

#### **Custom Metrics**
- Visit your metrics endpoint
- Monitor API request rates
- Check database operations
- Track queue processing

### **🚨 Troubleshooting**

#### **Service Not Starting**
- Check environment variables
- Verify start commands
- Check build logs

#### **Database Connection Errors**
- Verify `DATABASE_URL` format
- Check PostgreSQL service status
- Ensure SSL is enabled

#### **Redis Connection Errors**
- Verify `REDIS_URL` format
- Check Redis service status
- Ensure authentication is correct

### **📞 Support**

- **Railway Docs**: https://docs.railway.app/
- **Railway Discord**: https://discord.gg/railway
- **Application Logs**: Check Railway dashboard

---

**✅ Your Albion Aegis is now running on Railway!** ⚔️

The application will automatically:
- ✅ Fetch battles from Albion API
- ✅ Store data in PostgreSQL
- ✅ Process kill events via Redis queues
- ✅ Provide metrics and health checks
- ✅ Handle rate limiting and errors gracefully
