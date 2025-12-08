/**
 * Moderation Service Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { moderateContent, notifyModerators } from '../../src/services/moderation-service';
import { createMockEnv, resetCounters } from '../test-utils';
import type { Env } from '../../src/types';

// Mock fetch for external API calls
const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

describe('ModerationService', () => {
    beforeEach(() => {
        resetCounters();
        fetchMock = vi.fn();
        globalThis.fetch = fetchMock;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.clearAllMocks();
    });

    // ============================================
    // moderateContent - Local Filter
    // ============================================

    describe('moderateContent - Local Filter', () => {
        it('should pass clean content', async () => {
            const env = createMockEnv();

            const result = await moderateContent(
                'Beautiful Sunset Palette',
                'A lovely collection of warm sunset colors',
                env
            );

            expect(result.passed).toBe(true);
            expect(result.method).toBe('local'); // No Perspective API configured
        });

        it('should pass content when local lists are empty (relies on Perspective API)', async () => {
            const env = createMockEnv();

            // Since local profanity lists are intentionally empty,
            // content passes through local filter and relies on Perspective API
            const result = await moderateContent(
                'Any Content Here',
                'A normal description here',
                env
            );

            expect(result.passed).toBe(true);
            expect(result.method).toBe('local'); // No Perspective API configured
        });

        it('should return local method when no Perspective API configured', async () => {
            const env = createMockEnv({ PERSPECTIVE_API_KEY: undefined });

            const result = await moderateContent(
                'Normal Palette Name',
                'This description has some words',
                env
            );

            expect(result.passed).toBe(true);
            expect(result.method).toBe('local');
        });

        it('should handle empty name gracefully', async () => {
            const env = createMockEnv();

            const result = await moderateContent(
                '',
                'A valid description here',
                env
            );

            expect(result.passed).toBe(true);
        });

        it('should handle empty description gracefully', async () => {
            const env = createMockEnv();

            const result = await moderateContent(
                'Valid Palette Name',
                '',
                env
            );

            expect(result.passed).toBe(true);
        });

        it('should handle unicode content gracefully', async () => {
            const env = createMockEnv();

            const result = await moderateContent(
                '日本語パレット',
                '説明文がここにあります',
                env
            );

            expect(result.passed).toBe(true);
        });

        it('should handle special regex characters in content', async () => {
            const env = createMockEnv();

            // These characters could cause regex issues if not escaped
            const result = await moderateContent(
                'Test.*+?^${}()|[]\\',
                'Description with special [brackets] and {braces}',
                env
            );

            expect(result.passed).toBe(true);
        });

        it('should handle very long content', async () => {
            const env = createMockEnv();

            const result = await moderateContent(
                'A'.repeat(100),
                'B'.repeat(500),
                env
            );

            expect(result.passed).toBe(true);
        });

        it('should handle content with multiple whitespace', async () => {
            const env = createMockEnv();

            const result = await moderateContent(
                '  Spaced   Name  ',
                '  Description  with  lots    of    spaces  ',
                env
            );

            expect(result.passed).toBe(true);
        });
    });

    // ============================================
    // moderateContent - Perspective API
    // ============================================

    describe('moderateContent - Perspective API', () => {
        it('should skip Perspective API if not configured', async () => {
            const env = createMockEnv({ PERSPECTIVE_API_KEY: undefined });

            await moderateContent('Test', 'Test description', env);

            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('should call Perspective API when configured', async () => {
            const env = createMockEnv({ PERSPECTIVE_API_KEY: 'test-api-key' });

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    attributeScores: {
                        TOXICITY: { summaryScore: { value: 0.1 } },
                        SEVERE_TOXICITY: { summaryScore: { value: 0.05 } },
                        IDENTITY_ATTACK: { summaryScore: { value: 0.02 } },
                        INSULT: { summaryScore: { value: 0.1 } },
                        PROFANITY: { summaryScore: { value: 0.1 } },
                    },
                }),
            });

            const result = await moderateContent(
                'Nice Palette',
                'A beautiful description',
                env
            );

            expect(fetchMock).toHaveBeenCalledOnce();
            expect(result.passed).toBe(true);
            expect(result.method).toBe('all');
            expect(result.scores).toBeDefined();
        });

        it('should flag high toxicity from Perspective API', async () => {
            const env = createMockEnv({ PERSPECTIVE_API_KEY: 'test-api-key' });

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    attributeScores: {
                        TOXICITY: { summaryScore: { value: 0.85 } },
                        SEVERE_TOXICITY: { summaryScore: { value: 0.3 } },
                        IDENTITY_ATTACK: { summaryScore: { value: 0.1 } },
                        INSULT: { summaryScore: { value: 0.2 } },
                        PROFANITY: { summaryScore: { value: 0.15 } },
                    },
                }),
            });

            const result = await moderateContent(
                'Sneaky Bad Content',
                'Something the local filter missed',
                env
            );

            expect(result.passed).toBe(false);
            expect(result.method).toBe('perspective');
            expect(result.flaggedField).toBe('content');
            expect(result.flaggedReason).toContain('toxicity');
            expect(result.scores?.toxicity).toBe(0.85);
        });

        it('should flag any score above threshold', async () => {
            const env = createMockEnv({ PERSPECTIVE_API_KEY: 'test-api-key' });

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    attributeScores: {
                        TOXICITY: { summaryScore: { value: 0.3 } },
                        SEVERE_TOXICITY: { summaryScore: { value: 0.1 } },
                        IDENTITY_ATTACK: { summaryScore: { value: 0.75 } }, // Above threshold
                        INSULT: { summaryScore: { value: 0.2 } },
                        PROFANITY: { summaryScore: { value: 0.15 } },
                    },
                }),
            });

            const result = await moderateContent(
                'Test',
                'Test',
                env
            );

            expect(result.passed).toBe(false);
            expect(result.flaggedReason).toContain('identityAttack');
        });

        it('should gracefully handle Perspective API errors', async () => {
            const env = createMockEnv({ PERSPECTIVE_API_KEY: 'test-api-key' });

            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 500,
                text: async () => 'Internal Server Error',
            });

            const result = await moderateContent(
                'Test Palette',
                'Normal description',
                env
            );

            // Should still pass if local filter passed and API failed
            expect(result.passed).toBe(true);
            expect(result.method).toBe('local');
        });

        it('should gracefully handle network errors', async () => {
            const env = createMockEnv({ PERSPECTIVE_API_KEY: 'test-api-key' });

            fetchMock.mockRejectedValueOnce(new Error('Network error'));

            const result = await moderateContent(
                'Test Palette',
                'Normal description',
                env
            );

            expect(result.passed).toBe(true);
            expect(result.method).toBe('local');
        });

        it('should call Perspective API regardless since local lists are empty', async () => {
            const env = createMockEnv({ PERSPECTIVE_API_KEY: 'test-api-key' });

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    attributeScores: {
                        TOXICITY: { summaryScore: { value: 0.9 } },
                        SEVERE_TOXICITY: { summaryScore: { value: 0.1 } },
                        IDENTITY_ATTACK: { summaryScore: { value: 0.1 } },
                        INSULT: { summaryScore: { value: 0.1 } },
                        PROFANITY: { summaryScore: { value: 0.1 } },
                    },
                }),
            });

            const result = await moderateContent(
                'Some Palette',
                'Normal description',
                env
            );

            // Since local lists are empty, Perspective API is always called when configured
            expect(fetchMock).toHaveBeenCalledOnce();
            // If Perspective flags it, it should fail
            expect(result.passed).toBe(false);
        });
    });

    // ============================================
    // notifyModerators
    // ============================================

    describe('notifyModerators', () => {
        const mockAlert = {
            presetId: 'preset-123',
            presetName: 'Flagged Preset',
            description: 'This preset was flagged for review',
            dyes: [1, 2, 3],
            authorName: 'TestUser',
            authorId: 'user-456',
            flagReason: 'Contains prohibited content',
        };

        it('should skip if no webhook or bot token configured', async () => {
            const env = createMockEnv({
                MODERATION_WEBHOOK_URL: undefined,
                OWNER_DISCORD_ID: undefined,
                DISCORD_BOT_TOKEN: undefined,
            });

            await notifyModerators(mockAlert, env);

            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('should send webhook notification if configured', async () => {
            const env = createMockEnv({
                MODERATION_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
            });

            fetchMock.mockResolvedValueOnce({ ok: true });

            await notifyModerators(mockAlert, env);

            expect(fetchMock).toHaveBeenCalledOnce();
            expect(fetchMock).toHaveBeenCalledWith(
                'https://discord.com/api/webhooks/123/abc',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                })
            );
        });

        it('should send DM to owner if bot token configured', async () => {
            const env = createMockEnv({
                OWNER_DISCORD_ID: 'owner-123',
                DISCORD_BOT_TOKEN: 'bot-token-abc',
            });

            // Mock creating DM channel
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'dm-channel-id' }),
            });

            // Mock sending message
            fetchMock.mockResolvedValueOnce({ ok: true });

            await notifyModerators(mockAlert, env);

            expect(fetchMock).toHaveBeenCalledTimes(2);

            // First call creates DM channel
            expect(fetchMock).toHaveBeenNthCalledWith(
                1,
                'https://discord.com/api/v10/users/@me/channels',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        Authorization: 'Bot bot-token-abc',
                    }),
                })
            );

            // Second call sends message
            expect(fetchMock).toHaveBeenNthCalledWith(
                2,
                'https://discord.com/api/v10/channels/dm-channel-id/messages',
                expect.objectContaining({
                    method: 'POST',
                })
            );
        });

        it('should handle failed DM channel creation gracefully', async () => {
            const env = createMockEnv({
                OWNER_DISCORD_ID: 'owner-123',
                DISCORD_BOT_TOKEN: 'bot-token-abc',
            });

            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 403,
            });

            // Should not throw
            await expect(notifyModerators(mockAlert, env)).resolves.not.toThrow();
        });

        it('should handle webhook failure gracefully', async () => {
            const env = createMockEnv({
                MODERATION_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
            });

            fetchMock.mockRejectedValueOnce(new Error('Network error'));

            // Should not throw
            await expect(notifyModerators(mockAlert, env)).resolves.not.toThrow();
        });

        it('should include all alert fields in embed', async () => {
            const env = createMockEnv({
                MODERATION_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
            });

            fetchMock.mockResolvedValueOnce({ ok: true });

            await notifyModerators(mockAlert, env);

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            const embed = callBody.embeds[0];

            expect(embed.title).toContain('Pending Review');
            expect(embed.fields.some((f: { name: string }) => f.name === 'Name')).toBe(true);
            expect(embed.fields.some((f: { name: string }) => f.name === 'Submitted by')).toBe(true);
            expect(embed.fields.some((f: { name: string }) => f.name === 'Flagged Reason')).toBe(true);
        });

        it('should handle DM send failure gracefully', async () => {
            const env = createMockEnv({
                OWNER_DISCORD_ID: 'owner-123',
                DISCORD_BOT_TOKEN: 'bot-token-abc',
            });

            // Mock creating DM channel successfully
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'dm-channel-id' }),
            });

            // Mock sending message fails
            fetchMock.mockRejectedValueOnce(new Error('Failed to send DM'));

            // Should not throw
            await expect(notifyModerators(mockAlert, env)).resolves.not.toThrow();

            // Both requests should have been attempted
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('should send both webhook and DM if both configured', async () => {
            const env = createMockEnv({
                MODERATION_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
                OWNER_DISCORD_ID: 'owner-123',
                DISCORD_BOT_TOKEN: 'bot-token-abc',
            });

            // Webhook success
            fetchMock.mockResolvedValueOnce({ ok: true });
            // DM channel creation success
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'dm-channel-id' }),
            });
            // DM send success
            fetchMock.mockResolvedValueOnce({ ok: true });

            await notifyModerators(mockAlert, env);

            expect(fetchMock).toHaveBeenCalledTimes(3);
        });

        it('should truncate long descriptions in embed', async () => {
            const env = createMockEnv({
                MODERATION_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
            });

            const alertWithLongDesc = {
                ...mockAlert,
                description: 'A'.repeat(500), // Very long description
            };

            fetchMock.mockResolvedValueOnce({ ok: true });

            await notifyModerators(alertWithLongDesc, env);

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            const embed = callBody.embeds[0];
            const descField = embed.fields.find((f: { name: string }) => f.name === 'Description');

            // Description should be truncated to 200 chars
            expect(descField.value.length).toBeLessThanOrEqual(200);
        });
    });
});
