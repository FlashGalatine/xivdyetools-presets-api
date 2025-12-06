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
  findDuplicatePreset,
  createPreset,
} from '../services/preset-service.js';
import { moderateContent } from '../services/moderation-service.js';
import { addVote } from './votes.js';

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
// AUTHENTICATED ENDPOINTS (Bot Only)
// ============================================

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

  // If flagged, notify moderators
  if (!moderationResult.passed) {
    // TODO: Send notification to moderation channel
    console.log(`Preset ${preset.id} flagged for review: ${moderationResult.flaggedReason}`);
  }

  return c.json(
    {
      success: true,
      preset,
      moderation_status: status,
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
