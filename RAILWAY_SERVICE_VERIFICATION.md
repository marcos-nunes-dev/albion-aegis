# 🔍 Railway Service Verification Guide

## **Service-Specific Health Checks**

Since each Railway service has its own domain, here's how to verify each service:

### **1. Albion Scheduler Service**
- **Domain**: `https://albion-scheduler-production.up.railway.app`
- **Health Check**: No HTTP endpoints (background service)
- **Verification**: Check Railway logs for activity
- **Expected Logs**: 
  ```
  🚀 Starting Albion Aegis...
  🔄 Starting scheduler...
  Starting crawl loop...
  ```

### **2. Albion Kills Worker Service**
- **Domain**: `https://albion-kills-production.up.railway.app`
- **Health Check**: No HTTP endpoints (background service)
- **Verification**: Check Railway logs for activity
- **Expected Logs**:
  ```
  🚀 Starting Albion Aegis...
  ⚔️ Starting kills worker...
  Worker started, waiting for jobs...
  ```

### **3. Albion Metrics Service**
- **Domain**: `https://albion-metrics-production.up.railway.app`
- **Health Check**: `https://albion-metrics-production.up.railway.app/healthz`
- **Metrics**: `https://albion-metrics-production.up.railway.app/metrics`
- **Verification**: Visit the domain in browser
- **Expected Response**: JSON health status

## **Service Verification Steps**

### **Step 1: Check Service Status**
1. Go to Railway Dashboard
2. Check each service shows "Deployed" status
3. Verify no red error indicators

### **Step 2: Check Service Logs**
1. Click on each service
2. Go to "Logs" tab
3. Look for startup messages:
   ```
   🚀 Starting Albion Aegis...
   🗄️ Running database migrations...
   [Service-specific startup message]
   ```

### **Step 3: Test Metrics Service**
1. Go to `albion-metrics` service
2. Click the generated domain
3. Test health endpoint: `/healthz`
4. Test metrics endpoint: `/metrics`

### **Step 4: Monitor Activity**
- **Scheduler**: Should show periodic crawl logs
- **Kills Worker**: Should show job processing logs
- **Metrics**: Should respond to HTTP requests

## **Expected Service Behavior**

### **Scheduler Service**
- ✅ Runs every 45 seconds (configurable)
- ✅ Fetches battles from Albion API
- ✅ Stores data in database
- ✅ Enqueues kill jobs

### **Kills Worker Service**
- ✅ Processes kill jobs from queue
- ✅ Fetches kill events from API
- ✅ Stores kill data in database
- ✅ Updates battle records

### **Metrics Service**
- ✅ Responds to HTTP requests
- ✅ Provides health status
- ✅ Exposes Prometheus metrics
- ✅ Handles CORS and logging

## **Troubleshooting**

### **Service Not Starting**
- Check environment variables
- Verify `RAILWAY_SERVICE_NAME` is set correctly
- Check build logs for errors

### **No Activity in Logs**
- Verify database connection
- Check Redis connection
- Ensure API endpoints are accessible

### **Health Check Failing**
- Only applies to metrics service
- Check if service is listening on correct port
- Verify no firewall issues

## **Service URLs Summary**

| Service | Domain | Health Check | Purpose |
|---------|--------|--------------|---------|
| Scheduler | `https://albion-scheduler-*.up.railway.app` | None | Battle crawling |
| Kills Worker | `https://albion-kills-*.up.railway.app` | None | Kill processing |
| Metrics | `https://albion-metrics-*.up.railway.app` | `/healthz` | Monitoring |

---

**✅ All services should be running independently with their own domains!**
