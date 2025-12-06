/**
 * Presets Handler
 * Routes for preset listing, retrieval, and submission
 */

import { Hono } from 'hono';
import type { Env, AuthContext, PresetFilters, PresetSubmission } from '../types.js';
import { requireAuth, requireUserContext } from '../middleware/auth.js';
import {
  getPresets,
  getFeaturedPresets,
  getPresetById,
  getPresetsByUser,
  findDuplicatePreset,
  createPreset,
} from '../services/preset-service.js';
import { moderateContent } from '../services/moderation-service.js';
import { addVote } from './votes.js';
import { checkSubmissionRateLimit, getRemainingSubmissions } from '../services/rate-limit-service.js';

type Variables = {
  auth: AuthContext;
};

export const presetsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================
// PUBLIC ENDPOINTS
// ============================================

/**
 * GET /api/v1/presets
 * List presets with filtering and pagination
 */
presetsRouter.get('/', async (c) => {
  const { category, search, status, sort, page, limit, is_curated } = c.req.query();

  const filters: PresetFilters = {
    category: category as PresetFilters['category'],
    search,
    status: status as PresetFilters['status'],
    sort: sort as PresetFilters['sort'],
    page: page ? parseInt(page, 10) : undefined,
    limit: limit ? Math.min(parseInt(limit, 10), 100) : undefined,
    is_curated: is_curated === 'true' ? true : is_curated === 'false' ? false : undefined,
  };

  const response = await getPresets(c.env.DB, filters);
  return c.json(response);
});

/**
 * GET /api/v1/presets/featured
 * Get top-voted presets for homepage display
 */
presetsRouter.get('/featured', async (c) => {
  const presets = await getFeaturedPresets(c.env.DB);
  return c.json({ presets });
});

/**
 * GET /api/v1/presets/:id
 * Get a single preset by ID
 */
presetsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const preset = await getPresetById(c.env.DB, id);

  if (!preset) {
    return c.json({ error: 'Not Found', message: 'Preset not found' }, 404);
  }

  return c.json(preset);
});

// ============================================
// AUTHENTICATED ENDPOINTS
// ============================================

/**
 * GET /api/v1/presets/mine
 * Get the current user's submitted presets (all statuses)
 */
presetsRouter.get('/mine', async (c) => {
  // Require authentication
  const authError = requireAuth(c);
  if (authError) return authError;

  // Require user context
  const userError = requireUserContext(c);
  if (userError) return userError;

  const auth = c.get('auth');

  const presets = await getPresetsByUser(c.env.DB, auth.userDiscordId!);

  return c.json({
    presets,
    total: presets.length,
  });
});

/**
 * GET /api/v1/presets/rate-limit
 * Get remaining submissions for the authenticated user today
 */
presetsRouter.get('/rate-limit', async (c) => {
  // Require authentication
  const authError = requireAuth(c);
  if (authError) return authError;

  // Require user context
  const userError = requireUserContext(c);
  if (userError) return userError;

  const auth = c.get('auth');

  const { remaining, resetAt } = await getRemainingSubmissions(c.env.DB, auth.userDiscordId!);

  return c.json({
    remaining,
    limit: 10,
    reset_at: resetAt.toISOString(),
  });
});

/**
 * POST /api/v1/presets
 * Submit a new preset
 */
presetsRouter.post('/', async (c) => {
  // Require authentication
  const authError = requireAuth(c);
  if (authError) return authError;

  // Require user context
  const userError = requireUserContext(c);
  if (userError) return userError;

  const auth = c.get('auth');

  // Check rate limit (10 submissions per day)
  const rateLimitResult = await checkSubmissionRateLimit(c.env.DB, auth.userDiscordId!);
  if (!rateLimitResult.allowed) {
    return c.json(
      {
        error: 'Rate Limit Exceeded',
        message: `You've reached your daily submission limit (10 per day). Try again tomorrow.`,
        remaining: 0,
        reset_at: rateLimitResult.resetAt.toISOString(),
      },
      429
    );
  }

  // Parse request body
  let body: PresetSubmission;
  try {
    body = await c.req.json<PresetSubmission>();
  } catch {
    return c.json({ error: 'Bad Request', message: 'Invalid JSON body' }, 400);
  }

  // Validate submission
  const validationError = validateSubmission(body);
  if (validationError) {
    return c.json({ error: 'Validation Error', message: validationError }, 400);
  }

  // Check for duplicate
  const duplicate = await findDuplicatePreset(c.env.DB, body.dyes);
  if (duplicate) {
    // Add vote to existing preset
    const voteResult = await addVote(c.env.DB, duplicate.id, auth.userDiscordId!);

    return c.json({
      success: true,
      duplicate,
      vote_added: voteResult.success && !voteResult.already_voted,
    });
  }

  // Moderate content
  const moderationResult = await moderateContent(
    body.name,
    body.description,
    c.env
  );

  // Determine status based on moderation
  const status = moderationResult.passed ? 'approved' : 'pending';

  // Create preset
  const preset = await createPreset(
    c.env.DB,
    body,
    auth.userDiscordId!,
    auth.userName || 'Unknown User',
    status
  );

  // Auto-vote for own preset
  await addVote(c.env.DB, preset.id, auth.userDiscordId!);

  // Send notification to Discord bot (non-blocking)
  // This is fire-and-forget - submission succeeds even if notification fails
  notifyDiscordBot(c.env, {
    type: 'submission',
    preset: {
      ...preset,
      author_name: auth.userName || 'Unknown User',
      author_discord_id: auth.userDiscordId!,
      status,
      moderation_status: moderationResult.passed ? 'clean' : 'flagged',
      source: auth.authSource,
    },
  }).catch((err) => {
    // Log but don't fail the request
    console.error('Failed to notify Discord bot:', err);
  });

  // Get updated rate limit info
  const { remaining } = await getRemainingSubmissions(c.env.DB, auth.userDiscordId!);

  return c.json(
    {
      success: true,
      preset,
      moderation_status: status,
      remaining_submissions: remaining,
    },
    201
  );
});

// ============================================
// VALIDATION HELPERS
// ============================================

function validateSubmission(body: PresetSubmission): string | null {
  // Name validation (2-50 chars)
  if (!body.name || body.name.length < 2 || body.name.length > 50) {
    return 'Name must be 2-50 characters';
  }

  // Description validation (10-200 chars)
  if (!body.description || body.description.length < 10 || body.description.length > 200) {
    return 'Description must be 10-200 characters';
  }

  // Category validation
  const validCategories = ['jobs', 'grand-companies', 'seasons', 'events', 'aesthetics', 'community'];
  if (!body.category_id || !validCategories.includes(body.category_id)) {
    return 'Invalid category';
  }

  // Dyes validation (2-5 dyes)
  if (!Array.isArray(body.dyes) || body.dyes.length < 2 || body.dyes.length > 5) {
    return 'Must include 2-5 dyes';
  }

  // Validate dye IDs are numbers
  if (!body.dyes.every((id) => typeof id === 'number' && id > 0)) {
    return 'Invalid dye IDs';
  }

  // Tags validation (0-10 tags, max 30 chars each)
  if (!Array.isArray(body.tags)) {
    return 'Tags must be an array';
  }
  if (body.tags.length > 10) {
    return 'Maximum 10 tags allowed';
  }
  if (body.tags.some((tag) => typeof tag !== 'string' || tag.length > 30)) {
    return 'Each tag must be a string of max 30 characters';
  }

  return null;
}

// ============================================
// DISCORD BOT NOTIFICATION
// ============================================

interface PresetNotificationPayload {
  type: 'submission';
  preset: {
    id: string;
    name: string;
    description: string;
    category_id: string;
    dyes: number[];
    tags: string[];
    author_name: string;
    author_discord_id: string;
    status: 'pending' | 'approved' | 'rejected';
    moderation_status: 'clean' | 'flagged' | 'auto_approved';
    source: 'bot' | 'web' | 'none';
    created_at: string;
  };
}

/**
 * Notify the Discord bot about a new preset submission
 * This is a fire-and-forget operation - errors are logged but don't fail the request
 */
async function notifyDiscordBot(env: Env, payload: PresetNotificationPayload): Promise<void> {
  // Check if webhook is configured
  if (!env.DISCORD_BOT_WEBHOOK_URL || !env.INTERNAL_WEBHOOK_SECRET) {
    console.log('Discord bot webhook not configured, skipping notification');
    return;
  }

  const response = await fetch(`${env.DISCORD_BOT_WEBHOOK_URL}/internal/notify-submission`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.INTERNAL_WEBHOOK_SECRET}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord bot webhook returned ${response.status}: ${await response.text()}`);
  }
}
