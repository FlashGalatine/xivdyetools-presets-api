# XIV Dye Tools - Community Presets API

**v1.1.0** | Cloudflare Worker API for the XIV Dye Tools Community Presets system.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3%2B-blue)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020)](https://workers.cloudflare.com/)

## Overview

This Worker provides:
- REST API for preset palette CRUD operations
- Voting system with deduplication
- Multi-language content moderation (local + Perspective API)
- Moderator actions with audit logging
- Preset editing with revert capability

## Setup

### Prerequisites

- Node.js 18+
- Cloudflare account with Workers and D1 access
- Wrangler CLI (`npm install -g wrangler`)

### Installation

```bash
npm install
```

### Create D1 Database

```bash
# Create the database
wrangler d1 create xivdyetools-presets

# Update wrangler.toml with the database_id from the output
```

### Apply Schema

```bash
# Local development
npm run db:migrate:local

# Production
npm run db:migrate
```

### Seed Curated Presets

```bash
# Generate seed SQL from xivdyetools-core presets
npx tsx scripts/migrate-presets.ts > seed.sql

# Apply locally
wrangler d1 execute xivdyetools-presets --local --file=./seed.sql

# Apply to production
wrangler d1 execute xivdyetools-presets --file=./seed.sql
```

### Configure Secrets

```bash
# Required
wrangler secret put BOT_API_SECRET
wrangler secret put JWT_SECRET

# Moderation
wrangler secret put MODERATOR_IDS          # Comma-separated Discord IDs
wrangler secret put PERSPECTIVE_API_KEY    # Google Perspective API (optional)

# Notifications
wrangler secret put MODERATION_WEBHOOK_URL # Discord webhook
wrangler secret put OWNER_DISCORD_ID       # Bot owner for DM alerts
wrangler secret put DISCORD_BOT_TOKEN      # For sending DMs
```

## Development

```bash
# Start local development server
npm run dev

# Run tests
npm run test

# Type check
npm run type-check

# Deploy to Cloudflare
npm run deploy
npm run deploy:production
```

## API Endpoints

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/presets` | List presets (filterable) |
| GET | `/api/v1/presets/featured` | Top 10 by votes |
| GET | `/api/v1/presets/:id` | Get single preset |
| GET | `/api/v1/categories` | List categories with counts |

### Authenticated (Bot/Web)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/presets` | Submit new preset |
| PATCH | `/api/v1/presets/:id` | Edit preset (owner only) |
| POST | `/api/v1/votes/:id` | Vote for preset |
| DELETE | `/api/v1/votes/:id` | Remove vote |

### Moderator

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/moderation/pending` | List pending presets |
| PATCH | `/api/v1/moderation/:id/status` | Approve/reject preset |
| PATCH | `/api/v1/moderation/:id/revert` | Revert flagged edit |
| GET | `/api/v1/moderation/:id/history` | Moderation audit log |

## Authentication

### Bot Requests
```
Authorization: Bearer <BOT_API_SECRET>
X-User-Discord-ID: <discord_user_id>
X-User-Discord-Name: <display_name>
```

### Web App Requests
```
Authorization: Bearer <JWT from OAuth worker>
```

## Query Parameters

### GET /api/v1/presets

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `category` | string | - | Filter by category ID |
| `search` | string | - | Search name/description/tags |
| `status` | string | `approved` | Filter by status |
| `sort` | string | `popular` | `popular`, `recent`, `name` |
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Results per page (max 100) |
| `is_curated` | boolean | - | Filter curated/community |

## Response Examples

### Preset Object

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Sunset Warrior",
  "description": "Warm orange and red tones inspired by dusk",
  "category_id": "aesthetics",
  "dyes": [5738, 13115, 13117],
  "tags": ["warm", "sunset", "warrior"],
  "author_discord_id": "123456789012345678",
  "author_name": "Player#1234",
  "vote_count": 42,
  "status": "approved",
  "is_curated": false,
  "created_at": "2025-12-07T12:00:00Z",
  "updated_at": "2025-12-07T12:00:00Z"
}
```

### List Response

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "totalPages": 8
  }
}
```

### Error Response

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Name must be 2-50 characters"
  }
}
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request body or parameters |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `DUPLICATE_PRESET` | 409 | Dye combination already exists |
| `CONTENT_FLAGGED` | 422 | Content failed moderation |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

## Database Schema

### Tables

| Table | Description |
|-------|-------------|
| `categories` | Preset categories (jobs, seasons, etc.) |
| `presets` | Dye preset palettes |
| `votes` | User votes (one per user per preset) |
| `moderation_log` | Audit trail for mod actions |
| `rate_limits` | Request rate limiting |

### Preset Status Flow

```
submitted → pending → approved
                   ↘ rejected
                   ↘ flagged → (edit) → pending
```

## Content Moderation

### Two-Layer System

1. **Local Filter**: Fast multi-language profanity detection
   - Languages: English, Japanese, German, French, Korean, Chinese
   - Blocks obvious bad words immediately

2. **Perspective API** (optional): ML-based toxicity scoring
   - Threshold: 0.7 toxicity score
   - Falls back to local filter if API unavailable

### Moderation Workflow

1. User submits preset → Status: `pending`
2. Content moderation runs:
   - Pass → Status: `approved` (auto)
   - Fail → Status: `flagged` (awaits moderator)
3. Moderator reviews flagged presets:
   - Approve → Status: `approved`
   - Reject → Status: `rejected`
   - Revert → Restore previous values

## Rate Limiting

| Action | Limit |
|--------|-------|
| Submit preset | 5 per hour per user |
| Vote | 30 per minute per user |
| General API | 100 per minute per IP |

## Architecture

```
src/
├── index.ts              # Hono app entry point
├── types.ts              # TypeScript interfaces
├── handlers/
│   ├── presets.ts        # Preset CRUD endpoints
│   ├── votes.ts          # Voting endpoints
│   └── moderation.ts     # Moderation endpoints
├── services/
│   ├── preset-service.ts # Business logic
│   ├── vote-service.ts   # Vote operations
│   └── moderation.ts     # Content filtering
└── middleware/
    ├── auth.ts           # Bot/JWT authentication
    └── rate-limit.ts     # Request limiting
```

## Related Projects

- **[xivdyetools-core](../xivdyetools-core/)** - Core library with dye database
- **[xivdyetools-web-app](../xivdyetools-web-app/)** - Web app preset browser
- **[xivdyetools-discord-worker](../xivdyetools-discord-worker/)** - Discord bot integration
- **[xivdyetools-oauth](../xivdyetools-oauth/)** - OAuth authentication provider

## License

MIT © 2025 Flash Galatine

See [LICENSE](./LICENSE) for full details.

## Legal Notice

**This is a fan-made tool and is not affiliated with or endorsed by Square Enix Co., Ltd. FINAL FANTASY is a registered trademark of Square Enix Holdings Co., Ltd.**

## Support

- **Issues**: [GitHub Issues](https://github.com/FlashGalatine/xivdyetools-presets-api/issues)
- **Discord**: [Join Server](https://discord.gg/5VUSKTZCe5)

---

**Made with love for the FFXIV community**
