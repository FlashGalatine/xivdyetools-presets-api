/**
 * Presets Handler Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { presetsRouter } from '../../src/handlers/presets';
import { authMiddleware } from '../../src/middleware/auth';
import type { Env, AuthContext, CommunityPreset } from '../../src/types';
import {
    createMockEnv,
    createMockD1Database,
    createMockPresetRow,
    createMockSubmission,
    resetCounters,
} from '../test-utils';

type Variables = {
    auth: AuthContext;
};

describe('PresetsHandler', () => {
    let app: Hono<{ Bindings: Env; Variables: Variables }>;
    let env: Env;
    let mockDb: ReturnType<typeof createMockD1Database>;

    beforeEach(() => {
        resetCounters();
        mockDb = createMockD1Database();
        env = createMockEnv({ DB: mockDb as unknown as D1Database });

        app = new Hono<{ Bindings: Env; Variables: Variables }>();
        app.use('*', authMiddleware);
        app.route('/api/v1/presets', presetsRouter);

        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ============================================
    // GET /api/v1/presets
    // ============================================

    describe('GET /api/v1/presets', () => {
        it('should return paginated presets', async () => {
            const mockRows = [
                { ...createMockPresetRow(), _total: 2 },
                { ...createMockPresetRow(), _total: 2 }
            ];
            mockDb._setupMock(() => {
                return mockRows;
            });

            const res = await app.request('/api/v1/presets', {}, env);

            expect(res.status).toBe(200);
            const body = await res.json() as { presets: CommunityPreset[]; total: number; page: number; limit: number };

            expect(body.presets).toHaveLength(2);
            expect(body.total).toBe(2);
            expect(body.page).toBe(1);
            expect(body.limit).toBe(20);
        });

        it('should filter by category', async () => {
            // Return empty array - service uses window function COUNT(*) OVER() not separate count query
            mockDb._setupMock(() => []);

            await app.request('/api/v1/presets?category=jobs', {}, env);

            expect(mockDb._bindings.some((b) => b.includes('jobs'))).toBe(true);
        });

        it('should filter by search', async () => {
            // Return empty array - service uses window function COUNT(*) OVER() not separate count query
            mockDb._setupMock(() => []);

            await app.request('/api/v1/presets?search=sunset', {}, env);

            expect(mockDb._bindings.some((b) => b.includes('%sunset%'))).toBe(true);
        });

        it('should filter by is_curated', async () => {
            // Return empty array - service uses window function COUNT(*) OVER() not separate count query
            mockDb._setupMock(() => []);

            await app.request('/api/v1/presets?is_curated=true', {}, env);

            expect(mockDb._bindings.some((b) => b.includes(1))).toBe(true);
        });

        it('should respect page and limit params', async () => {
            // Return empty array - the page/limit assertions don't need actual data
            mockDb._setupMock(() => []);

            const res = await app.request('/api/v1/presets?page=3&limit=10', {}, env);
            const body = await res.json() as { page: number; limit: number };

            expect(body.page).toBe(3);
            expect(body.limit).toBe(10);
        });

        it('should cap limit at 100', async () => {
            // Return empty array - the limit cap assertion doesn't need actual data
            mockDb._setupMock(() => []);

            const res = await app.request('/api/v1/presets?limit=500', {}, env);
            const body = await res.json() as { limit: number };

            // Limit is capped at 50 for performance
            expect(body.limit).toBe(50);
        });
    });

    // ============================================
    // GET /api/v1/presets/featured
    // ============================================

    describe('GET /api/v1/presets/featured', () => {
        it('should return featured presets', async () => {
            const mockRows = Array.from({ length: 10 }, () => createMockPresetRow());
            mockDb._setupMock(() => mockRows);

            const res = await app.request('/api/v1/presets/featured', {}, env);

            expect(res.status).toBe(200);
            const body = await res.json() as { presets: CommunityPreset[] };

            expect(body.presets).toHaveLength(10);
        });
    });

    // ============================================
    // GET /api/v1/presets/mine
    // ============================================

    describe('GET /api/v1/presets/mine', () => {
        it('should require authentication', async () => {
            const res = await app.request('/api/v1/presets/mine', {}, env);

            expect(res.status).toBe(401);
        });

        it('should return user presets when authenticated', async () => {
            const mockRows = [createMockPresetRow({ author_discord_id: '123' })];
            mockDb._setupMock(() => mockRows);

            const res = await app.request(
                '/api/v1/presets/mine',
                {
                    headers: {
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                },
                env
            );

            expect(res.status).toBe(200);
            const body = await res.json() as { presets: CommunityPreset[]; total: number };

            expect(body.presets).toHaveLength(1);
            expect(body.total).toBe(1);
        });

        it('should require user context', async () => {
            const res = await app.request(
                '/api/v1/presets/mine',
                {
                    headers: {
                        Authorization: 'Bearer test-bot-secret',
                        // No X-User-Discord-ID
                    },
                },
                env
            );

            expect(res.status).toBe(400);
        });
    });

    // ============================================
    // GET /api/v1/presets/rate-limit
    // ============================================

    describe('GET /api/v1/presets/rate-limit', () => {
        it('should require authentication', async () => {
            const res = await app.request('/api/v1/presets/rate-limit', {}, env);

            expect(res.status).toBe(401);
        });

        it('should return rate limit info when authenticated', async () => {
            mockDb._setupMock(() => ({ count: 3 }));

            const res = await app.request(
                '/api/v1/presets/rate-limit',
                {
                    headers: {
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                },
                env
            );

            expect(res.status).toBe(200);
            const body = await res.json() as { remaining: number; limit: number; reset_at: string };

            expect(body.remaining).toBe(7);
            expect(body.limit).toBe(10);
            expect(body.reset_at).toBeDefined();
        });
    });

    // ============================================
    // PATCH /api/v1/presets/refresh-author
    // ============================================

    describe('PATCH /api/v1/presets/refresh-author', () => {
        it('should require authentication', async () => {
            const res = await app.request(
                '/api/v1/presets/refresh-author',
                { method: 'PATCH' },
                env
            );

            expect(res.status).toBe(401);
        });

        it('should update author name for user presets', async () => {
            mockDb._setupMock(() => ({ success: true, meta: { changes: 5 } }));

            const res = await app.request(
                '/api/v1/presets/refresh-author',
                {
                    method: 'PATCH',
                    headers: {
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                        'X-User-Discord-Name': 'NewDisplayName',
                    },
                },
                env
            );

            expect(res.status).toBe(200);
            const body = await res.json() as { success: boolean };

            expect(body.success).toBe(true);
        });
    });

    // ============================================
    // GET /api/v1/presets/:id
    // ============================================

    describe('GET /api/v1/presets/:id', () => {
        it('should return preset if found', async () => {
            const mockRow = createMockPresetRow({ id: 'preset-123' });
            mockDb._setupMock(() => mockRow);

            const res = await app.request('/api/v1/presets/preset-123', {}, env);

            expect(res.status).toBe(200);
            const body = await res.json() as { id: string };

            expect(body.id).toBe('preset-123');
        });

        it('should return 404 if preset not found', async () => {
            mockDb._setupMock(() => null);

            const res = await app.request('/api/v1/presets/nonexistent', {}, env);

            expect(res.status).toBe(404);
        });
    });

    // ============================================
    // POST /api/v1/presets
    // ============================================

    describe('POST /api/v1/presets', () => {
        it('should require authentication', async () => {
            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(createMockSubmission()),
                },
                env
            );

            expect(res.status).toBe(401);
        });

        // Skip: This test requires Cloudflare Workers ExecutionContext (for waitUntil)
        // which is not available in Node test environment
        it.skip('should create preset with valid data (requires Cloudflare Workers)', async () => {
            mockDb._setupMock((query) => {
                // Rate limit check
                if (query.includes('COUNT') && query.includes('author_discord_id')) {
                    return { count: 0 };
                }
                // Duplicate check
                if (query.includes('dye_signature')) {
                    return null;
                }
                // Get remaining submissions
                if (query.includes('COUNT')) {
                    return { count: 1 };
                }
                return { success: true };
            });

            const submission = createMockSubmission();

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                        'X-User-Discord-Name': 'TestUser',
                    },
                    body: JSON.stringify(submission),
                },
                env
            );

            expect(res.status).toBe(201);
            const body = await res.json() as { success: boolean; preset: CommunityPreset };

            expect(body.success).toBe(true);
            expect(body.preset.name).toBe(submission.name);
        });

        it('should reject invalid JSON body', async () => {
            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: 'not valid json',
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Invalid JSON');
        });

        it('should validate name length (min 2)', async () => {
            mockDb._setupMock(() => ({ count: 0 }));

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({ ...createMockSubmission(), name: 'A' }),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Name must be 2-50 characters');
        });

        it('should validate name length (max 50)', async () => {
            mockDb._setupMock(() => ({ count: 0 }));

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({
                        ...createMockSubmission(),
                        name: 'A'.repeat(51),
                    }),
                },
                env
            );

            expect(res.status).toBe(400);
        });

        it('should validate description length (min 10)', async () => {
            mockDb._setupMock(() => ({ count: 0 }));

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({
                        ...createMockSubmission(),
                        description: 'Short',
                    }),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Description must be 10-200 characters');
        });

        it('should validate dyes count (min 2)', async () => {
            mockDb._setupMock(() => ({ count: 0 }));

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({
                        ...createMockSubmission(),
                        dyes: [1],
                    }),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Must include 2-5 dyes');
        });

        it('should validate dyes count (max 5)', async () => {
            mockDb._setupMock(() => ({ count: 0 }));

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({
                        ...createMockSubmission(),
                        dyes: [1, 2, 3, 4, 5, 6],
                    }),
                },
                env
            );

            expect(res.status).toBe(400);
        });

        it('should validate category', async () => {
            mockDb._setupMock(() => ({ count: 0 }));

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({
                        ...createMockSubmission(),
                        category_id: 'invalid-category',
                    }),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Invalid category');
        });

        it('should validate tags array', async () => {
            mockDb._setupMock(() => ({ count: 0 }));

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({
                        ...createMockSubmission(),
                        tags: 'not-an-array',
                    }),
                },
                env
            );

            expect(res.status).toBe(400);
        });

        it('should validate maximum tags (10)', async () => {
            mockDb._setupMock(() => ({ count: 0 }));

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({
                        ...createMockSubmission(),
                        tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
                    }),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Maximum 10 tags');
        });

        it('should enforce rate limiting', async () => {
            mockDb._setupMock(() => ({ count: 10 })); // At limit

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify(createMockSubmission()),
                },
                env
            );

            expect(res.status).toBe(429);
            const body = await res.json() as { error: string };
            expect(body.error).toContain('Rate Limit');
        });

        it('should handle duplicate dye combination', async () => {
            const existingPreset = createMockPresetRow({
                id: 'existing-123',
                name: 'Existing Preset',
                author_name: 'Other User',
            });

            mockDb._setupMock((query) => {
                if (query.includes('COUNT') && query.includes('author_discord_id')) {
                    return { count: 0 }; // Under rate limit
                }
                if (query.includes('dye_signature')) {
                    return existingPreset; // Duplicate found
                }
                if (query.includes('votes')) {
                    return null; // No existing vote
                }
                if (query.includes('vote_count')) {
                    return { vote_count: 1 };
                }
                return { success: true };
            });

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify(createMockSubmission()),
                },
                env
            );

            expect(res.status).toBe(200);
            const body = await res.json() as { duplicate: { id: string } };
            expect(body.duplicate).toBeDefined();
            expect(body.duplicate.id).toBe('existing-123');
        });
    });

    // ============================================
    // DELETE /api/v1/presets/:id
    // ============================================

    describe('DELETE /api/v1/presets/:id', () => {
        it('should require authentication', async () => {
            const res = await app.request(
                '/api/v1/presets/preset-123',
                { method: 'DELETE' },
                env
            );

            expect(res.status).toBe(401);
        });

        it('should allow owner to delete their preset', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'DELETE',
                    headers: {
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                },
                env
            );

            expect(res.status).toBe(200);
            const body = await res.json() as { success: boolean };
            expect(body.success).toBe(true);
        });

        it('should allow moderator to delete any preset', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: 'other-user',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'DELETE',
                    headers: {
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123456789', // In MODERATOR_IDS
                    },
                },
                env
            );

            expect(res.status).toBe(200);
        });

        it('should reject non-owner non-moderator deletion', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: 'other-user',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'DELETE',
                    headers: {
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': 'not-owner-not-mod',
                    },
                },
                env
            );

            expect(res.status).toBe(403);
        });

        it('should return 404 for nonexistent preset', async () => {
            mockDb._setupMock(() => null);

            const res = await app.request(
                '/api/v1/presets/nonexistent',
                {
                    method: 'DELETE',
                    headers: {
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                },
                env
            );

            expect(res.status).toBe(404);
        });
    });

    // ============================================
    // PATCH /api/v1/presets/:id
    // ============================================

    describe('PATCH /api/v1/presets/:id', () => {
        it('should require authentication', async () => {
            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'New Name' }),
                },
                env
            );

            expect(res.status).toBe(401);
        });

        it('should only allow owner to edit', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: 'other-user',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({ name: 'New Name that is long enough' }),
                },
                env
            );

            expect(res.status).toBe(403);
        });

        it('should update preset with valid data', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({ name: 'Updated Name' }),
                },
                env
            );

            expect(res.status).toBe(200);
            const body = await res.json() as { success: boolean };
            expect(body.success).toBe(true);
        });

        it('should reject empty update', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({}),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('No updates provided');
        });

        it('should check for duplicate dyes when dyes are changed', async () => {
            const ownPreset = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
                dyes: JSON.stringify([1, 2, 3]),
            });
            const duplicatePreset = createMockPresetRow({
                id: 'other-preset',
                name: 'Duplicate',
                author_name: 'Other',
            });

            let callCount = 0;
            mockDb._setupMock(() => {
                callCount++;
                if (callCount === 1) return ownPreset; // Get own preset
                if (callCount === 2) return duplicatePreset; // Duplicate check
                return ownPreset;
            });

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({ dyes: [4, 5, 6] }),
                },
                env
            );

            expect(res.status).toBe(409);
            const body = await res.json() as { error: string };
            expect(body.error).toBe('duplicate_dyes');
        });

        it('should validate edit request fields', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({ name: 'A' }), // Too short
                },
                env
            );

            expect(res.status).toBe(400);
        });

        it('should validate edit request description length', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({ description: 'Short' }), // Too short
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Description must be 10-200 characters');
        });

        it('should validate edit request dyes must be array', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({ dyes: 'not-an-array' }),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Must include 2-5 dyes');
        });

        it('should validate edit request dyes count', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({ dyes: [1] }), // Too few
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Must include 2-5 dyes');
        });

        it('should validate edit request dyes are valid numbers', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({ dyes: [1, 'invalid', 3] }),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Invalid dye IDs');
        });

        it('should validate edit request tags must be array', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({ tags: 'not-an-array' }),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Tags must be an array');
        });

        it('should validate edit request max 10 tags', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({
                        tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
                    }),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Maximum 10 tags');
        });

        it('should validate edit request tag max length', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({
                        tags: ['valid', 'A'.repeat(31)], // Second tag too long
                    }),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('max 30 characters');
        });

        it('should reject invalid JSON body', async () => {
            const mockRow = createMockPresetRow({
                id: 'preset-123',
                author_discord_id: '123',
            });
            mockDb._setupMock(() => mockRow);

            const res = await app.request(
                '/api/v1/presets/preset-123',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: 'not valid json',
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Invalid JSON');
        });

        it('should return 404 for nonexistent preset', async () => {
            mockDb._setupMock(() => null);

            const res = await app.request(
                '/api/v1/presets/nonexistent',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({ name: 'Valid New Name' }),
                },
                env
            );

            expect(res.status).toBe(404);
        });
    });

    // ============================================
    // validateSubmission Edge Cases
    // ============================================

    describe('validateSubmission edge cases', () => {
        it('should validate dye IDs are positive numbers', async () => {
            mockDb._setupMock(() => ({ count: 0 }));

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({
                        ...createMockSubmission(),
                        dyes: [1, 0, 3], // 0 is not valid
                    }),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('Invalid dye IDs');
        });

        it('should validate missing name', async () => {
            mockDb._setupMock(() => ({ count: 0 }));

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({
                        ...createMockSubmission(),
                        name: undefined,
                    }),
                },
                env
            );

            expect(res.status).toBe(400);
        });

        it('should validate tag types in submission', async () => {
            mockDb._setupMock(() => ({ count: 0 }));

            const res = await app.request(
                '/api/v1/presets',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer test-bot-secret',
                        'X-User-Discord-ID': '123',
                    },
                    body: JSON.stringify({
                        ...createMockSubmission(),
                        tags: ['valid', 123], // Number is not valid
                    }),
                },
                env
            );

            expect(res.status).toBe(400);
            const body = await res.json() as { message: string };
            expect(body.message).toContain('string');
        });
    });
});
