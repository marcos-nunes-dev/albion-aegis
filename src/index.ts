import { config, getConfigSummary } from './lib/config.js';

console.log("service booting");

// Log configuration summary (no secrets)
const configSummary = getConfigSummary();
console.log("📋 Configuration Summary:");
Object.entries(configSummary).forEach(([key, value]) => {
  console.log(`  ${key}: ${value}`);
});

console.log(`🚀 Albion Aegis starting in ${config.NODE_ENV} mode`);
