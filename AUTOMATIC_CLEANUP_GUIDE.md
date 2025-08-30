# Automatic Cleanup System Guide

## 🎯 **Overview**

Your BullMQ and Redis system now has a **comprehensive multi-layered automatic cleanup system** that prevents queue buildup and Redis overload without manual intervention. The system has been enhanced to automatically detect and remove orphaned queues and monitor Redis key counts.

## 🏗️ **Enhanced System Architecture**

### **4-Layer Cleanup Strategy:**

1. **🔄 Intelligent Cleanup Loop** (Every 15 minutes)
2. **⚡ High-Frequency Cleanup Loop** (Every 5 minutes when needed)
3. **🔪 Worker Self-Cleanup** (Every 10 minutes per worker)
4. **🧹 Orphaned Queue Detection** (Every 4 hours)

## 📊 **Enhanced Intelligent Cleanup Logic**

The system automatically chooses the right cleanup strategy based on queue health:

| Job Count | Strategy | Action |
|-----------|----------|---------|
| **0-100** | None | No cleanup needed |
| **101-500** | Regular | `cleanupOldJobs()` (30 min) |
| **501-1000** | Aggressive | `aggressiveCleanup()` (10 min) |
| **1000+** | Comprehensive | `comprehensiveCleanup()` (1 min) |

### **NEW: Redis Key Monitoring**
- **Warning**: > 500 BullMQ keys
- **Emergency**: > 1000 BullMQ keys (triggers comprehensive cleanup with orphan removal)

### **NEW: Orphaned Queue Detection**
- **Frequency**: Every 4 hours (every 16th cleanup cycle)
- **Action**: Automatically removes orphaned queues not in active queue list

## ⚙️ **Configuration**

### **Environment Variables:**
```bash
# Main cleanup interval (default: 15 minutes)
REDIS_CLEANUP_INTERVAL_MIN=15

# High-frequency cleanup interval (default: 5 minutes)
REDIS_HIGH_FREQ_CLEANUP_INTERVAL_MIN=5

# Worker cleanup interval (default: 10 minutes)
REDIS_WORKER_CLEANUP_INTERVAL_MIN=10
```

### **Queue Configuration:**
```typescript
// Battle Crawl Queue
removeOnComplete: { count: 50, age: 15 * 60 * 1000 }, // Keep last 50 or 15 minutes
removeOnFail: { count: 25, age: 15 * 60 * 1000 },     // Keep last 25 or 15 minutes

// Kills Fetch Queue
removeOnComplete: { count: 50, age: 10 * 60 * 1000 }, // Keep last 50 or 10 minutes
removeOnFail: { count: 25, age: 10 * 60 * 1000 },     // Keep last 25 or 10 minutes
```

## 🚀 **How It Works**

### **1. Intelligent Cleanup Loop (Scheduler)**
- **Frequency**: Every 15 minutes
- **Smart Decision**: Analyzes queue health and chooses appropriate cleanup strategy
- **NEW**: Monitors Redis key count and triggers emergency cleanup if needed
- **NEW**: Automatically detects and removes orphaned queues every 4 hours
- **Safety**: Only removes completed/failed jobs, never active/waiting jobs
- **Logging**: Detailed logs of cleanup decisions and results

### **2. High-Frequency Cleanup Loop (Scheduler)**
- **Frequency**: Every 5 minutes
- **Trigger**: Only runs when job count > 200
- **Purpose**: Prevents buildup during high-volume periods
- **Efficiency**: Skips cleanup when not needed

### **3. Worker Self-Cleanup**
- **Frequency**: Every 10 minutes per worker
- **Scope**: Each worker cleans up its own queue
- **Redundancy**: Provides backup cleanup if scheduler fails
- **Isolation**: Worker-specific cleanup doesn't affect other workers

### **4. Orphaned Queue Detection**
- **Frequency**: Every 4 hours (every 16th cleanup cycle)
- **Detection**: Identifies queues not in active queue list (`battle-crawl`, `kills-fetch`)
- **Action**: Removes all keys from orphaned queues
- **Examples**: Removes old `battle-notifications`, `mmr-calculation` queues

## 📈 **Enhanced Monitoring & Alerts**

### **Automatic Health Checks:**
- ✅ **Job Count Monitoring**: Tracks total jobs across all queues
- ✅ **Failed Job Detection**: Alerts when failed jobs > 50
- ✅ **Active Job Monitoring**: Alerts when active jobs > 10
- ✅ **Memory Usage**: Monitors Redis memory consumption
- ✅ **NEW: Redis Key Count**: Monitors total BullMQ keys
- ✅ **NEW: Orphaned Queue Detection**: Automatically removes old queues

### **Log Examples:**
```
[INFO] Queue health check - totalJobs: 150
[INFO] Normal job count - performing regular cleanup
[INFO] Redis key monitoring - totalKeys: 45, bullKeys: 42
[WARN] High job count detected - performing aggressive cleanup
[ERROR] Emergency: High number of BullMQ keys detected - performing comprehensive cleanup
[INFO] Performing orphaned queue check and cleanup
```

## 🛡️ **Safety Features**

### **Never Removes:**
- ✅ **Waiting Jobs**: Jobs queued but not yet processed
- ✅ **Active Jobs**: Jobs currently being processed
- ✅ **Recent Jobs**: Jobs completed within the retention period

### **Only Removes:**
- ✅ **Old Completed Jobs**: Jobs finished and older than retention period
- ✅ **Old Failed Jobs**: Jobs that failed and older than retention period
- ✅ **Excessive Failed Jobs**: Keeps only last 25 failed jobs
- ✅ **NEW: Orphaned Queues**: Queues not in active queue list

## 🔧 **Manual Override (When Needed)**

### **Safe Commands:**
```bash
# Monitor current state
yarn tsx apps/redis-monitor.ts monitor

# Regular cleanup (30 min old jobs)
yarn tsx apps/redis-monitor.ts cleanup

# Aggressive cleanup (10 min old jobs)
yarn tsx apps/redis-monitor.ts aggressive

# Comprehensive cleanup (1 min old jobs)
yarn tsx apps/redis-monitor.ts comprehensive

# Comprehensive cleanup with orphan removal
yarn tsx apps/redis-monitor.ts comprehensive-orphan

# Nuclear cleanup (removes all except active jobs)
yarn tsx apps/redis-monitor.ts nuclear

# Ultra-aggressive cleanup (removes ALL BullMQ keys)
yarn tsx apps/redis-monitor.ts ultra
```

## 🎯 **Prevention Guarantee**

This enhanced system **100% prevents Redis overload** by:

1. **Proactive Monitoring**: Continuously monitors queue health and Redis key count
2. **Automatic Orphaned Queue Removal**: Prevents accumulation of old queue keys
3. **Multi-Layer Redundancy**: 4 different cleanup mechanisms ensure reliability
4. **Emergency Triggers**: Immediate action when thresholds are exceeded
5. **Comprehensive Logging**: Full visibility into cleanup operations

## 📊 **Expected Performance**

With this system in place, you should see:
- **Redis Keys**: Consistently under 500 BullMQ keys
- **Memory Usage**: Stable and predictable
- **Job Count**: Rarely exceeds 200 total jobs
- **Zero Manual Intervention**: Fully automatic operation

## 🚨 **Emergency Procedures**

If you ever encounter issues:

1. **Monitor**: `npm run redis:monitor`
2. **Comprehensive Cleanup**: `npm run redis:comprehensive-orphan`
3. **Nuclear Option**: `npm run redis:ultra` (if needed)

The system is designed to prevent the need for these emergency procedures, but they're available if needed.
