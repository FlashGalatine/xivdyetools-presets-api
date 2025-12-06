/**
 * Rate Limit Service
 * Tracks submission limits per user per day
 * Limit: 10 submissions per user per day
 */

import type { RateLimitResult } from '../types.js';

/**
 * Maximum submissions per user per day
 */
const DAILY_SUBMISSION_LIMIT = 10;

/**
 * Check if a user can submit a preset
 * Returns rate limit status and remaining submissions
 */
export async function checkSubmissionRateLimit(
  db: D1Database,
  userDiscordId: string
): Promise<RateLimitResult> {
  const today = getStartOfDayUTC();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  // Count submissions today for this user
  const query = `
    SELECT COUNT(*) as count
    FROM presets
    WHERE author_discord_id = ?
      AND created_at >= ?
      AND created_at < ?
  `;

  const result = await db
    .prepare(query)
    .bind(userDiscordId, today.toISOString(), tomorrow.toISOString())
    .first<{ count: number }>();

  const submissionsToday = result?.count || 0;
  const remaining = Math.max(0, DAILY_SUBMISSION_LIMIT - submissionsToday);

  return {
    allowed: submissionsToday < DAILY_SUBMISSION_LIMIT,
    remaining,
    resetAt: tomorrow,
  };
}

/**
 * Get remaining submissions for a user today
 * Useful for displaying in the UI
 */
export async function getRemainingSubmissions(
  db: D1Database,
  userDiscordId: string
): Promise<{ remaining: number; resetAt: Date }> {
  const result = await checkSubmissionRateLimit(db, userDiscordId);
  return {
    remaining: result.remaining,
    resetAt: result.resetAt,
  };
}

/**
 * Get the start of the current day in UTC
 */
function getStartOfDayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
