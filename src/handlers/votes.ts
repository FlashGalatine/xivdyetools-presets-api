/**
 * Votes Handler
 * Routes for voting on presets
 */

import { Hono } from 'hono';
import type { Env, AuthContext, VoteResponse } from '../types.js';
import { requireAuth, requireUserContext } from '../middleware/auth.js';

type Variables = {
  auth: AuthContext;
};

export const votesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Add a vote to a preset
 * Used internally and exposed via API
 */
export async function addVote(
  db: D1Database,
  presetId: string,
  userDiscordId: string
): Promise<VoteResponse> {
  // Check if already voted
  const existingVote = await db
    .prepare('SELECT 1 FROM votes WHERE preset_id = ? AND user_discord_id = ?')
    .bind(presetId, userDiscordId)
    .first();

  if (existingVote) {
    // Get current vote count
    const preset = await db
      .prepare('SELECT vote_count FROM presets WHERE id = ?')
      .bind(presetId)
      .first<{ vote_count: number }>();

    return {
      success: false,
      already_voted: true,
      new_vote_count: preset?.vote_count || 0,
    };
  }

  // Add vote and increment count in a transaction
  const now = new Date().toISOString();

  try {
    await db.batch([
      db.prepare('INSERT INTO votes (preset_id, user_discord_id, created_at) VALUES (?, ?, ?)').bind(
        presetId,
        userDiscordId,
        now
      ),
      db.prepare('UPDATE presets SET vote_count = vote_count + 1, updated_at = ? WHERE id = ?').bind(
        now,
        presetId
      ),
    ]);

    // Get new vote count
    const preset = await db
      .prepare('SELECT vote_count FROM presets WHERE id = ?')
      .bind(presetId)
      .first<{ vote_count: number }>();

    return {
      success: true,
      new_vote_count: preset?.vote_count || 1,
    };
  } catch (error) {
    console.error('Failed to add vote:', error);
    return {
      success: false,
      new_vote_count: 0,
      error: 'Failed to add vote',
    };
  }
}

/**
 * Remove a vote from a preset
 */
export async function removeVote(
  db: D1Database,
  presetId: string,
  userDiscordId: string
): Promise<VoteResponse> {
  // Check if vote exists
  const existingVote = await db
    .prepare('SELECT 1 FROM votes WHERE preset_id = ? AND user_discord_id = ?')
    .bind(presetId, userDiscordId)
    .first();

  if (!existingVote) {
    // Get current vote count
    const preset = await db
      .prepare('SELECT vote_count FROM presets WHERE id = ?')
      .bind(presetId)
      .first<{ vote_count: number }>();

    return {
      success: false,
      already_voted: false,
      new_vote_count: preset?.vote_count || 0,
    };
  }

  // Remove vote and decrement count
  const now = new Date().toISOString();

  try {
    await db.batch([
      db.prepare('DELETE FROM votes WHERE preset_id = ? AND user_discord_id = ?').bind(
        presetId,
        userDiscordId
      ),
      db.prepare(
        'UPDATE presets SET vote_count = MAX(0, vote_count - 1), updated_at = ? WHERE id = ?'
      ).bind(now, presetId),
    ]);

    // Get new vote count
    const preset = await db
      .prepare('SELECT vote_count FROM presets WHERE id = ?')
      .bind(presetId)
      .first<{ vote_count: number }>();

    return {
      success: true,
      new_vote_count: preset?.vote_count || 0,
    };
  } catch (error) {
    console.error('Failed to remove vote:', error);
    return {
      success: false,
      new_vote_count: 0,
      error: 'Failed to remove vote',
    };
  }
}

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/v1/votes/:presetId
 * Add a vote to a preset
 */
votesRouter.post('/:presetId', async (c) => {
  // Require authentication
  const authError = requireAuth(c);
  if (authError) return authError;

  // Require user context
  const userError = requireUserContext(c);
  if (userError) return userError;

  const auth = c.get('auth');
  const presetId = c.req.param('presetId');

  // Check preset exists
  const preset = await c.env.DB.prepare('SELECT id FROM presets WHERE id = ?')
    .bind(presetId)
    .first();

  if (!preset) {
    return c.json({ error: 'Not Found', message: 'Preset not found' }, 404);
  }

  const result = await addVote(c.env.DB, presetId, auth.userDiscordId!);

  if (result.already_voted) {
    return c.json(result, 409); // Conflict
  }

  return c.json(result);
});

/**
 * DELETE /api/v1/votes/:presetId
 * Remove a vote from a preset
 */
votesRouter.delete('/:presetId', async (c) => {
  // Require authentication
  const authError = requireAuth(c);
  if (authError) return authError;

  // Require user context
  const userError = requireUserContext(c);
  if (userError) return userError;

  const auth = c.get('auth');
  const presetId = c.req.param('presetId');

  // Check preset exists
  const preset = await c.env.DB.prepare('SELECT id FROM presets WHERE id = ?')
    .bind(presetId)
    .first();

  if (!preset) {
    return c.json({ error: 'Not Found', message: 'Preset not found' }, 404);
  }

  const result = await removeVote(c.env.DB, presetId, auth.userDiscordId!);
  return c.json(result);
});

/**
 * GET /api/v1/votes/:presetId/check
 * Check if current user has voted for a preset
 */
votesRouter.get('/:presetId/check', async (c) => {
  // Require authentication
  const authError = requireAuth(c);
  if (authError) return authError;

  // Require user context
  const userError = requireUserContext(c);
  if (userError) return userError;

  const auth = c.get('auth');
  const presetId = c.req.param('presetId');

  const vote = await c.env.DB.prepare(
    'SELECT 1 FROM votes WHERE preset_id = ? AND user_discord_id = ?'
  )
    .bind(presetId, auth.userDiscordId!)
    .first();

  return c.json({ has_voted: !!vote });
});
