# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2025-12-14

### Deprecated

#### Type Re-exports
The following re-exports from `src/types.ts` are deprecated and will be removed in the next major version:

- **Preset Types**: Import from `@xivdyetools/types` instead
- **Auth Types** (AuthSource, AuthContext): Import from `@xivdyetools/types` instead
- **API Types** (ModerationResult, ModerationLogEntry, etc.): Import from `@xivdyetools/types` instead

**Note:** Project-specific types (Env, PresetRow, CategoryRow, VoteRow) remain unchanged.

**Migration Guide:**
```typescript
// Before (deprecated)
import { PresetStatus, CommunityPreset, AuthContext } from './types';

// After (recommended)
import type { PresetStatus, CommunityPreset, AuthContext } from '@xivdyetools/types';
```

---

## [1.1.0] - 2025-12-07

### Added

#### Preset Editing
- `PATCH /api/v1/presets/:id` - Edit existing preset (owner only)
  - Update name, description, dyes, tags
  - Duplicate dye combination detection (409 response with existing preset)
  - Content moderation on edited text
  - Stores previous_values for potential revert

#### Moderation Revert
- `PATCH /api/v1/moderation/:id/revert` - Revert flagged edit
  - Restores preset from previous_values
  - Logs reason in moderation_log
  - Clears previous_values after revert

### Changed

#### Database Schema
- Added `previous_values` column to presets table (stores pre-edit JSON)

#### Service Functions
- `updatePreset()` - Edit preset with validation and moderation
- `findDuplicatePresetExcluding()` - Check dye signature excluding specific preset
- `revertPreset()` - Restore from previous_values

### Files Modified
- `schema.sql` - Added previous_values column
- `src/types.ts` - PresetEditRequest, EditResponse, PreviousValues types
- `src/services/preset-service.ts` - Edit/revert functions
- `src/handlers/presets.ts` - PATCH endpoint
- `src/handlers/moderation.ts` - Revert endpoint

---

## [1.0.0] - 2025-12-07

### Added

#### API Endpoints

**Public:**
- `GET /api/v1/presets` - List presets with filtering and pagination
- `GET /api/v1/presets/featured` - Top 10 presets by vote count
- `GET /api/v1/presets/:id` - Get single preset details
- `GET /api/v1/categories` - List categories with preset counts

**Authenticated (Bot/Web):**
- `POST /api/v1/presets` - Submit new preset
- `POST /api/v1/votes/:id` - Vote for a preset
- `DELETE /api/v1/votes/:id` - Remove vote

**Moderator:**
- `GET /api/v1/moderation/pending` - List pending presets for review
- `PATCH /api/v1/moderation/:id/status` - Approve/reject preset
- `GET /api/v1/moderation/:id/history` - View moderation audit log

#### Features
- **Voting System**: User voting with deduplication (one vote per user per preset)
- **Preset Categories**: Organized browsing by theme/category
- **Search**: Full-text search across name, description, and tags
- **Pagination**: Configurable page size (max 100) with cursor-based pagination
- **Sorting**: By popularity, recency, or alphabetical

#### Content Moderation
- **Local Profanity Filter**: Multi-language bad word detection
- **Perspective API**: Optional ML-based toxicity detection (Google API)
- **Moderation Workflow**: Pending → Approved/Rejected/Flagged status flow
- **Audit Logging**: Full history of moderation actions with reasons

#### Authentication
- **Dual Auth Support**:
  - Bot API: Bearer token (BOT_API_SECRET) + X-User-Discord-ID header
  - Web App: JWT bearer token from OAuth worker
- **Moderator Verification**: MODERATOR_IDS environment variable for admin access

#### Infrastructure
- **Cloudflare D1**: SQLite-compatible database for preset storage
- **Hono Framework**: Fast, lightweight routing
- **Service Binding Ready**: Direct worker-to-worker communication support
