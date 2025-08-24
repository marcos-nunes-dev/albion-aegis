# 🔧 Railway Redis Authentication Fix

## **The Problem**
You're getting `NOAUTH Authentication required` errors because Railway Redis requires authentication, but the connection isn't working properly.

## **Solution Steps**

### **1. Check Your Railway Redis URL Format**

Go to your Railway Dashboard → `albion-redis` service → "Connect" tab.

Your `REDIS_URL` should look like this:
```
rediss://:password@hostname:port
```

**Note**: 
- `rediss://` (with double 's') for SSL
- `:password@` (password after colon, before @)
- No username (just password)

### **2. Verify Environment Variables**

In each of your Railway services (`albion-scheduler`, `albion-kills`, `albion-metrics`), make sure:

1. **Go to service settings**
2. **Click "Variables" tab**
3. **Check `REDIS_URL` format**

The URL should be:
```bash
REDIS_URL=rediss://:your-password@your-hostname:port
```

### **3. Common Issues & Fixes**

#### **Issue 1: Wrong URL Format**
❌ **Wrong**: `redis://hostname:port`
✅ **Correct**: `rediss://:password@hostname:port`

#### **Issue 2: Missing Password**
❌ **Wrong**: `rediss://hostname:port`
✅ **Correct**: `rediss://:password@hostname:port`

#### **Issue 3: Wrong Protocol**
❌ **Wrong**: `redis://:password@hostname:port`
✅ **Correct**: `rediss://:password@hostname:port`

### **4. Test Redis Connection**

After fixing the URL, redeploy your services and check the logs. You should see:

```bash
🔗 Redis: Connected
✅ Redis: Ready
```

Instead of:
```bash
❌ Redis: Connection error: NOAUTH Authentication required.
```

### **5. Railway Redis URL Example**

From Railway Redis service, your URL should look like:
```
rediss://:abc123def456@containers-us-west-123.railway.app:7890
```

### **6. Environment Variable Setup**

For each service, set:
```bash
REDIS_URL=rediss://:your-actual-password@your-actual-hostname:port
```

### **7. Redeploy Services**

After fixing the `REDIS_URL`:

1. **Go to each service** (scheduler, kills, metrics)
2. **Click "Deploy"** to trigger a new deployment
3. **Check logs** for Redis connection success

### **8. Verify Fix**

Look for these logs:
```bash
🚀 Starting Albion Aegis...
🗄️ Running database migrations...
🔗 Redis: Connected
✅ Redis: Ready
[Service-specific startup message]
```

## **Troubleshooting**

### **Still Getting Auth Errors?**
1. Double-check the URL format
2. Make sure you copied the password correctly
3. Verify the hostname and port
4. Ensure you're using `rediss://` (SSL)

### **Connection Timeout?**
1. Check if Railway Redis service is running
2. Verify the hostname is correct
3. Check if port is correct

### **Other Issues?**
1. Check Railway Redis service logs
2. Verify the service is in the same project
3. Check Railway status page

---

**✅ After fixing the `REDIS_URL`, your services should connect to Redis successfully!**
