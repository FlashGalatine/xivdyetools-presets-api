/**
 * XIV Dye Tools Worker - Type Definitions
 */

// ============================================
// CLOUDFLARE BINDINGS
// ============================================

export interface Env {
  // D1 Database
  DB: D1Database;

  // Environment variables
  ENVIRONMENT: string;
  API_VERSION: string;
  CORS_ORIGIN: string;

  // Secrets (set via wrangler secret put)
  BOT_API_SECRET: string;
  MODERATOR_IDS: string;
  PERSPECTIVE_API_KEY?: string;
  MODERATION_WEBHOOK_URL?: string;
  OWNER_DISCORD_ID?: string;
  DISCORD_BOT_TOKEN?: string;
}

// ============================================
// PRESET TYPES
// ============================================

export type PresetStatus = 'pending' | 'approved' | 'rejected' | 'flagged';

export type PresetCategory =
  | 'jobs'
  | 'grand-companies'
  | 'seasons'
  | 'events'
  | 'aesthetics'
  | 'community';

export interface CategoryMeta {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  is_curated: boolean;
  display_order: number;
  preset_count?: number;
}

export interface CommunityPreset {
  id: string;
  name: string;
  description: string;
  category_id: PresetCategory;
  dyes: number[];
  tags: string[];
  author_discord_id: string | null;
  author_name: string | null;
  vote_count: number;
  status: PresetStatus;
  is_curated: boolean;
  created_at: string;
  updated_at: string;
  dye_signature?: string;
}

export interface PresetSubmission {
  name: string;
  description: string;
  category_id: PresetCategory;
  dyes: number[];
  tags: string[];
}

// ============================================
// API REQUEST/RESPONSE TYPES
// ============================================

export interface PresetFilters {
  category?: PresetCategory;
  search?: string;
  status?: PresetStatus;
  sort?: 'popular' | 'recent' | 'name';
  page?: number;
  limit?: number;
  is_curated?: boolean;
}

export interface PresetListResponse {
  presets: CommunityPreset[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface PresetSubmitResponse {
  success: boolean;
  preset?: CommunityPreset;
  duplicate?: CommunityPreset;
  vote_added?: boolean;
  moderation_status?: 'approved' | 'pending';
  error?: string;
}

export interface VoteResponse {
  success: boolean;
  new_vote_count: number;
  already_voted?: boolean;
  error?: string;
}

export interface ModerationResponse {
  success: boolean;
  preset?: CommunityPreset;
  error?: string;
}

export interface CategoryListResponse {
  categories: CategoryMeta[];
}

// ============================================
// MODERATION TYPES
// ============================================

export interface ModerationResult {
  passed: boolean;
  flaggedField?: 'name' | 'description' | 'content';
  flaggedReason?: string;
  method: 'local' | 'perspective' | 'all';
  scores?: Record<string, number>;
}

export interface ModerationLogEntry {
  id: string;
  preset_id: string;
  moderator_discord_id: string;
  action: 'approve' | 'reject' | 'flag' | 'unflag';
  reason: string | null;
  created_at: string;
}

// ============================================
// DATABASE ROW TYPES (raw from D1)
// ============================================

export interface PresetRow {
  id: string;
  name: string;
  description: string;
  category_id: string;
  dyes: string; // JSON string
  tags: string; // JSON string
  author_discord_id: string | null;
  author_name: string | null;
  vote_count: number;
  status: string;
  is_curated: number; // SQLite boolean (0 or 1)
  created_at: string;
  updated_at: string;
  dye_signature: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  is_curated: number;
  display_order: number;
}

export interface VoteRow {
  preset_id: string;
  user_discord_id: string;
  created_at: string;
}

// ============================================
// UTILITY TYPES
// ============================================

export interface AuthContext {
  isAuthenticated: boolean;
  isModerator: boolean;
  userDiscordId?: string;
  userName?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}
