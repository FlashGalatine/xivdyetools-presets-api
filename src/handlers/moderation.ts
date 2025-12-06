/**
 * Moderation Handler
 * Routes for moderator actions
 */

import { Hono } from 'hono';
import type { Env, AuthContext, PresetStatus } from '../types.js';
import { requireModerator } from '../middleware/auth.js';
import { getPresetById, getPendingPresets, updatePresetStatus } from '../services/preset-service.js';

type Variables = {
  auth: AuthContext;
};

export const moderationRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /api/v1/moderation/pending
 * List presets pending moderation
 */
moderationRouter.get('/pending', async (c) => {
  // Require moderator privileges
  const modError = requireModerator(c);
  if (modError) return modError;

  const presets = await getPendingPresets(c.env.DB);
  return c.json({ presets, total: presets.length });
});

/**
 * PATCH /api/v1/moderation/:presetId/status
 * Approve, reject, flag, or unflag a preset
 */
moderationRouter.patch('/:presetId/status', async (c) => {
  // Require moderator privileges
  const modError = requireModerator(c);
  if (modError) return modError;

  const auth = c.get('auth');
  const presetId = c.req.param('presetId');

  // Parse request body
  let body: { status: PresetStatus; reason?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Bad Request', message: 'Invalid JSON body' }, 400);
  }

  // Validate status
  const validStatuses: PresetStatus[] = ['approved', 'rejected', 'flagged', 'pending'];
  if (!body.status || !validStatuses.includes(body.status)) {
    return c.json(
      {
        error: 'Validation Error',
        message: `Status must be one of: ${validStatuses.join(', ')}`,
      },
      400
    );
  }

  // Get current preset
  const preset = await getPresetById(c.env.DB, presetId);
  if (!preset) {
    return c.json({ error: 'Not Found', message: 'Preset not found' }, 404);
  }

  // Log moderation action
  const logId = crypto.randomUUID();
  const now = new Date().toISOString();
  const action = getActionFromStatusChange(preset.status, body.status);

  await c.env.DB.prepare(
    `INSERT INTO moderation_log (id, preset_id, moderator_discord_id, action, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(logId, presetId, auth.userDiscordId!, action, body.reason || null, now)
    .run();

  // Update preset status
  const updatedPreset = await updatePresetStatus(c.env.DB, presetId, body.status);

  return c.json({
    success: true,
    preset: updatedPreset,
  });
});

/**
 * GET /api/v1/moderation/:presetId/history
 * Get moderation history for a preset
 */
moderationRouter.get('/:presetId/history', async (c) => {
  // Require moderator privileges
  const modError = requireModerator(c);
  if (modError) return modError;

  const presetId = c.req.param('presetId');

  const query = `
    SELECT id, preset_id, moderator_discord_id, action, reason, created_at
    FROM moderation_log
    WHERE preset_id = ?
    ORDER BY created_at DESC
  `;

  const result = await c.env.DB.prepare(query).bind(presetId).all();
  return c.json({ history: result.results || [] });
});

/**
 * GET /api/v1/moderation/stats
 * Get moderation statistics
 */
moderationRouter.get('/stats', async (c) => {
  // Require moderator privileges
  const modError = requireModerator(c);
  if (modError) return modError;

  const query = `
    SELECT
      (SELECT COUNT(*) FROM presets WHERE status = 'pending') as pending,
      (SELECT COUNT(*) FROM presets WHERE status = 'approved') as approved,
      (SELECT COUNT(*) FROM presets WHERE status = 'rejected') as rejected,
      (SELECT COUNT(*) FROM presets WHERE status = 'flagged') as flagged,
      (SELECT COUNT(*) FROM moderation_log WHERE created_at > datetime('now', '-7 days')) as actions_last_week
  `;

  const stats = await c.env.DB.prepare(query).first();
  return c.json({ stats });
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function getActionFromStatusChange(
  oldStatus: PresetStatus,
  newStatus: PresetStatus
): 'approve' | 'reject' | 'flag' | 'unflag' {
  if (newStatus === 'approved') return 'approve';
  if (newStatus === 'rejected') return 'reject';
  if (newStatus === 'flagged') return 'flag';
  if (oldStatus === 'flagged' && newStatus === 'approved') return 'unflag';
  return 'approve'; // Default fallback
}
