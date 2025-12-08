/**
 * Moderation Service
 * Multi-language profanity filtering with local lists + Perspective API
 */

import type { Env, ModerationResult } from '../types.js';
import { profanityLists } from '../data/profanity/index.js';

// ============================================
// LOCAL PROFANITY FILTER
// ============================================

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pre-compiled profanity regex patterns
 * PERFORMANCE: Compile once at module load, not per-request
 * Each entry contains the pre-compiled regex for word-boundary matching
 */
const compiledProfanityPatterns: RegExp[] = (() => {
  const patterns: RegExp[] = [];

  for (const [_locale, words] of Object.entries(profanityLists)) {
    for (const word of words) {
      // Use word boundary matching for better accuracy
      // Pre-compile once to avoid per-request regex compilation
      patterns.push(new RegExp(`\\b${escapeRegex(word.toLowerCase())}\\b`, 'i'));
    }
  }

  return patterns;
})();

/**
 * Check text against local profanity word lists
 * Uses pre-compiled regex patterns for performance
 */
function checkLocalFilter(
  name: string,
  description: string
): ModerationResult | null {
  const textToCheck = `${name} ${description}`.toLowerCase();
  const nameLower = name.toLowerCase();

  // Check against all pre-compiled patterns
  for (const regex of compiledProfanityPatterns) {
    if (regex.test(textToCheck)) {
      // Determine which field was flagged
      const flaggedField = regex.test(nameLower) ? 'name' : 'description';
      return {
        passed: false,
        flaggedField,
        flaggedReason: 'Contains prohibited content',
        method: 'local',
      };
    }
  }

  return null;
}

// ============================================
// PERSPECTIVE API INTEGRATION
// ============================================

interface PerspectiveResponse {
  attributeScores: {
    TOXICITY?: { summaryScore: { value: number } };
    SEVERE_TOXICITY?: { summaryScore: { value: number } };
    IDENTITY_ATTACK?: { summaryScore: { value: number } };
    INSULT?: { summaryScore: { value: number } };
    PROFANITY?: { summaryScore: { value: number } };
  };
}

/**
 * Check text using Google Perspective API
 * Returns null if API is not configured or fails
 */
async function checkWithPerspective(
  text: string,
  env: Env
): Promise<ModerationResult | null> {
  if (!env.PERSPECTIVE_API_KEY) {
    return null; // Skip if not configured
  }

  try {
    const response = await fetch(
      `https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=${env.PERSPECTIVE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment: { text },
          requestedAttributes: {
            TOXICITY: {},
            SEVERE_TOXICITY: {},
            IDENTITY_ATTACK: {},
            INSULT: {},
            PROFANITY: {},
          },
        }),
      }
    );

    if (!response.ok) {
      console.error('Perspective API error:', response.status, await response.text());
      return null; // Don't block on API failure
    }

    const result: PerspectiveResponse = await response.json();

    const scores: Record<string, number> = {
      toxicity: result.attributeScores.TOXICITY?.summaryScore?.value || 0,
      severeToxicity: result.attributeScores.SEVERE_TOXICITY?.summaryScore?.value || 0,
      identityAttack: result.attributeScores.IDENTITY_ATTACK?.summaryScore?.value || 0,
      insult: result.attributeScores.INSULT?.summaryScore?.value || 0,
      profanity: result.attributeScores.PROFANITY?.summaryScore?.value || 0,
    };

    // Threshold for flagging (0.7 = 70% confidence)
    const threshold = 0.7;

    // Check each score against threshold
    for (const [key, value] of Object.entries(scores)) {
      if (value >= threshold) {
        return {
          passed: false,
          flaggedField: 'content',
          flaggedReason: `High ${key} score detected (${Math.round(value * 100)}%)`,
          method: 'perspective',
          scores,
        };
      }
    }

    // All scores below threshold
    return {
      passed: true,
      method: 'perspective',
      scores,
    };
  } catch (error) {
    console.error('Perspective API error:', error);
    return null; // Don't block on API failure
  }
}

// ============================================
// MAIN MODERATION FUNCTION
// ============================================

/**
 * Moderate content using local filter and optional Perspective API
 */
export async function moderateContent(
  name: string,
  description: string,
  env: Env
): Promise<ModerationResult> {
  // 1. Local word filter (fast, always runs)
  const localResult = checkLocalFilter(name, description);
  if (localResult && !localResult.passed) {
    return localResult;
  }

  // 2. Perspective API (optional, catches evasion/context)
  const perspectiveResult = await checkWithPerspective(
    `${name} ${description}`,
    env
  );

  if (perspectiveResult && !perspectiveResult.passed) {
    return perspectiveResult;
  }

  // All checks passed
  return {
    passed: true,
    method: perspectiveResult ? 'all' : 'local',
    scores: perspectiveResult?.scores,
  };
}

// ============================================
// NOTIFICATION SERVICE (for flagged content)
// ============================================

interface ModerationAlert {
  presetId: string;
  presetName: string;
  description: string;
  dyes: number[];
  authorName: string;
  authorId: string;
  flagReason: string;
}

/**
 * Notify moderators about flagged content
 */
export async function notifyModerators(
  alert: ModerationAlert,
  env: Env
): Promise<void> {
  const embed = {
    title: '⚠️ Palette Pending Review',
    color: 0xffa500, // Orange
    fields: [
      { name: 'Name', value: alert.presetName, inline: true },
      { name: 'Submitted by', value: alert.authorName, inline: true },
      { name: 'Flagged Reason', value: alert.flagReason, inline: false },
      { name: 'Description', value: alert.description.substring(0, 200), inline: false },
      { name: 'Preset ID', value: `\`${alert.presetId}\``, inline: false },
    ],
    footer: {
      text: 'Use /preset moderate approve <id> or /preset moderate reject <id> <reason>',
    },
    timestamp: new Date().toISOString(),
  };

  // 1. Post to moderation channel webhook
  if (env.MODERATION_WEBHOOK_URL) {
    try {
      await fetch(env.MODERATION_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      });
    } catch (error) {
      console.error('Failed to send webhook notification:', error);
    }
  }

  // 2. DM the bot owner via Discord Bot API
  if (env.OWNER_DISCORD_ID && env.DISCORD_BOT_TOKEN) {
    try {
      // Create DM channel
      const dmChannelResponse = await fetch(
        'https://discord.com/api/v10/users/@me/channels',
        {
          method: 'POST',
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ recipient_id: env.OWNER_DISCORD_ID }),
        }
      );

      if (dmChannelResponse.ok) {
        const dmChannel = (await dmChannelResponse.json()) as { id: string };

        // Send DM
        await fetch(
          `https://discord.com/api/v10/channels/${dmChannel.id}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ embeds: [embed] }),
          }
        );
      }
    } catch (error) {
      console.error('Failed to send DM notification:', error);
    }
  }
}
