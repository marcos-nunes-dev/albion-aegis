import { prisma } from '../db/prisma.js';
import { config } from '../lib/config.js';

// Watermark key for service state
const WATERMARK_KEY = 'battle_ingestion_watermark';

// Default watermark (Unix epoch)
const DEFAULT_WATERMARK = '1970-01-01T00:00:00.000Z';

/**
 * Get the current watermark for battle ingestion
 * @returns ISO timestamp string of the last processed battle
 */
export async function getWatermark(): Promise<string> {
  try {
    const state = await prisma.serviceState.findUnique({
      where: { key: WATERMARK_KEY }
    });

    if (!state) {
      console.log(`📍 No watermark found, using default: ${DEFAULT_WATERMARK}`);
      return DEFAULT_WATERMARK;
    }

    console.log(`📍 Current watermark: ${state.value}`);
    return state.value;

  } catch (error) {
    console.error('❌ Failed to get watermark:', error);
    console.log(`📍 Falling back to default watermark: ${DEFAULT_WATERMARK}`);
    return DEFAULT_WATERMARK;
  }
}

/**
 * Set the watermark for battle ingestion
 * Clamps advancement to now - SOFT_LOOKBACK_MIN to ensure we don't miss recent battles
 * @param iso ISO timestamp string to set as the new watermark
 */
export async function setWatermark(iso: string): Promise<void> {
  try {
    // Validate the input is a valid ISO string
    const inputDate = new Date(iso);
    if (isNaN(inputDate.getTime())) {
      throw new Error(`Invalid ISO timestamp: ${iso}`);
    }

    // Calculate the maximum allowed watermark (now - SOFT_LOOKBACK_MIN)
    const now = new Date();
    const maxWatermark = new Date(now.getTime() - (config.SOFT_LOOKBACK_MIN * 60 * 1000));
    
    // Clamp the watermark to ensure we don't advance too far
    const clampedDate = inputDate > maxWatermark ? maxWatermark : inputDate;
    const clampedIso = clampedDate.toISOString();

    // Log if we clamped the watermark
    if (clampedIso !== iso) {
      console.log(`⚠️  Watermark clamped from ${iso} to ${clampedIso} (soft lookback: ${config.SOFT_LOOKBACK_MIN}min)`);
    }

    // Upsert the watermark in the database
    await prisma.serviceState.upsert({
      where: { key: WATERMARK_KEY },
      update: { 
        value: clampedIso,
        updatedAt: new Date()
      },
      create: { 
        key: WATERMARK_KEY,
        value: clampedIso
      }
    });

    console.log(`✅ Watermark updated: ${clampedIso}`);

  } catch (error) {
    console.error('❌ Failed to set watermark:', error);
    throw error;
  }
}

/**
 * Get the effective lookback time for battle ingestion
 * This is the watermark minus additional buffer for safety
 * @returns ISO timestamp string for the effective start time
 */
export async function getEffectiveLookback(): Promise<string> {
  const watermark = await getWatermark();
  const watermarkDate = new Date(watermark);
  
  // Add a small buffer (5 minutes) before the watermark for safety
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  const effectiveDate = new Date(watermarkDate.getTime() - bufferMs);
  
  return effectiveDate.toISOString();
}

/**
 * Check if a battle timestamp is newer than the current watermark
 * @param battleTimestamp ISO timestamp of the battle
 * @returns true if the battle is newer than the watermark
 */
export async function isBattleNewer(battleTimestamp: string): Promise<boolean> {
  const watermark = await getWatermark();
  const watermarkDate = new Date(watermark);
  const battleDate = new Date(battleTimestamp);
  
  return battleDate > watermarkDate;
}

/**
 * Get watermark statistics for monitoring
 * @returns Object with watermark info and timing statistics
 */
export async function getWatermarkStats() {
  const watermark = await getWatermark();
  const watermarkDate = new Date(watermark);
  const now = new Date();
  
  const ageMs = now.getTime() - watermarkDate.getTime();
  const ageMinutes = Math.floor(ageMs / (60 * 1000));
  const ageHours = Math.floor(ageMinutes / 60);
  
  const maxWatermark = new Date(now.getTime() - (config.SOFT_LOOKBACK_MIN * 60 * 1000));
  const isAtLimit = watermarkDate >= maxWatermark;
  
  return {
    watermark,
    watermarkDate,
    ageMs,
    ageMinutes,
    ageHours,
    isAtLimit,
    softLookbackMin: config.SOFT_LOOKBACK_MIN,
    maxAllowedWatermark: maxWatermark.toISOString()
  };
}
