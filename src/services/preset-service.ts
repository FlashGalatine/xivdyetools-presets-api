/**
 * Preset Service
 * Handles preset CRUD operations with duplicate detection
 */

import type {
  Env,
  CommunityPreset,
  PresetRow,
  PresetFilters,
  PresetListResponse,
  PresetSubmission,
} from '../types.js';

/**
 * Generate a dye signature for duplicate detection
 * Sorts dye IDs and returns a JSON string
 */
export function generateDyeSignature(dyes: number[]): string {
  const sorted = [...dyes].sort((a, b) => a - b);
  return JSON.stringify(sorted);
}

/**
 * Convert database row to CommunityPreset
 */
export function rowToPreset(row: PresetRow): CommunityPreset {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category_id: row.category_id as CommunityPreset['category_id'],
    dyes: JSON.parse(row.dyes),
    tags: JSON.parse(row.tags),
    author_discord_id: row.author_discord_id,
    author_name: row.author_name,
    vote_count: row.vote_count,
    status: row.status as CommunityPreset['status'],
    is_curated: row.is_curated === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    dye_signature: row.dye_signature || undefined,
  };
}

/**
 * Get presets with filtering and pagination
 */
export async function getPresets(
  db: D1Database,
  filters: PresetFilters
): Promise<PresetListResponse> {
  const {
    category,
    search,
    status = 'approved',
    sort = 'popular',
    page = 1,
    limit = 20,
    is_curated,
  } = filters;

  // Build WHERE clause
  const conditions: string[] = ['status = ?'];
  const params: (string | number)[] = [status];

  if (category) {
    conditions.push('category_id = ?');
    params.push(category);
  }

  if (search) {
    conditions.push('(name LIKE ? OR description LIKE ? OR tags LIKE ?)');
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  if (is_curated !== undefined) {
    conditions.push('is_curated = ?');
    params.push(is_curated ? 1 : 0);
  }

  const whereClause = conditions.join(' AND ');

  // Build ORDER BY clause
  let orderBy: string;
  switch (sort) {
    case 'recent':
      orderBy = 'created_at DESC';
      break;
    case 'name':
      orderBy = 'name ASC';
      break;
    case 'popular':
    default:
      orderBy = 'vote_count DESC, created_at DESC';
      break;
  }

  // Get total count
  const countQuery = `SELECT COUNT(*) as total FROM presets WHERE ${whereClause}`;
  const countResult = await db.prepare(countQuery).bind(...params).first<{ total: number }>();
  const total = countResult?.total || 0;

  // Get paginated results
  const offset = (page - 1) * limit;
  const dataQuery = `
    SELECT * FROM presets
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
  const dataResult = await db
    .prepare(dataQuery)
    .bind(...params, limit, offset)
    .all<PresetRow>();

  const presets = (dataResult.results || []).map(rowToPreset);

  return {
    presets,
    total,
    page,
    limit,
    has_more: offset + presets.length < total,
  };
}

/**
 * Get featured presets (top 10 by votes)
 */
export async function getFeaturedPresets(db: D1Database): Promise<CommunityPreset[]> {
  const query = `
    SELECT * FROM presets
    WHERE status = 'approved'
    ORDER BY vote_count DESC, created_at DESC
    LIMIT 10
  `;
  const result = await db.prepare(query).all<PresetRow>();
  return (result.results || []).map(rowToPreset);
}

/**
 * Get a single preset by ID
 */
export async function getPresetById(
  db: D1Database,
  id: string
): Promise<CommunityPreset | null> {
  const query = 'SELECT * FROM presets WHERE id = ?';
  const row = await db.prepare(query).bind(id).first<PresetRow>();
  return row ? rowToPreset(row) : null;
}

/**
 * Check for duplicate preset by dye signature
 */
export async function findDuplicatePreset(
  db: D1Database,
  dyes: number[]
): Promise<CommunityPreset | null> {
  const signature = generateDyeSignature(dyes);
  const query = `
    SELECT * FROM presets
    WHERE dye_signature = ? AND status IN ('approved', 'pending')
    LIMIT 1
  `;
  const row = await db.prepare(query).bind(signature).first<PresetRow>();
  return row ? rowToPreset(row) : null;
}

/**
 * Create a new preset
 */
export async function createPreset(
  db: D1Database,
  submission: PresetSubmission,
  authorDiscordId: string,
  authorName: string,
  status: 'approved' | 'pending' = 'approved'
): Promise<CommunityPreset> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const dyeSignature = generateDyeSignature(submission.dyes);

  const query = `
    INSERT INTO presets (
      id, name, description, category_id, dyes, tags,
      author_discord_id, author_name, vote_count, status, is_curated,
      created_at, updated_at, dye_signature
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)
  `;

  await db
    .prepare(query)
    .bind(
      id,
      submission.name,
      submission.description,
      submission.category_id,
      JSON.stringify(submission.dyes),
      JSON.stringify(submission.tags),
      authorDiscordId,
      authorName,
      status,
      now,
      now,
      dyeSignature
    )
    .run();

  return {
    id,
    name: submission.name,
    description: submission.description,
    category_id: submission.category_id,
    dyes: submission.dyes,
    tags: submission.tags,
    author_discord_id: authorDiscordId,
    author_name: authorName,
    vote_count: 0,
    status,
    is_curated: false,
    created_at: now,
    updated_at: now,
    dye_signature: dyeSignature,
  };
}

/**
 * Update preset status
 */
export async function updatePresetStatus(
  db: D1Database,
  id: string,
  status: CommunityPreset['status']
): Promise<CommunityPreset | null> {
  const now = new Date().toISOString();
  const query = `
    UPDATE presets
    SET status = ?, updated_at = ?
    WHERE id = ?
  `;
  await db.prepare(query).bind(status, now, id).run();
  return getPresetById(db, id);
}

/**
 * Get pending presets for moderation
 */
export async function getPendingPresets(db: D1Database): Promise<CommunityPreset[]> {
  const query = `
    SELECT * FROM presets
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `;
  const result = await db.prepare(query).all<PresetRow>();
  return (result.results || []).map(rowToPreset);
}
