import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './package.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('nuget search adapter', () => {
    const cmd = getRegistry().get('nuget/search');

    it('rejects bad args before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ query: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'foo', limit: 99999 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('throttled', { status: 429 })));
        await expect(cmd.func({ query: 'newtonsoft' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError on empty data list', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 })));
        await expect(cmd.func({ query: 'no-such-package' })).rejects.toThrow(EmptyResultError);
    });

    it('round-trips package id into nuget.org URL', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: [{
                id: 'Newtonsoft.Json', version: '13.0.3',
                title: 'Json.NET', description: 'Json.NET is a popular high-performance JSON framework for .NET',
                authors: ['James Newton-King'], tags: ['json'], totalDownloads: 1000000, verified: true,
                projectUrl: 'https://www.newtonsoft.com/json',
            }],
        }), { status: 200 })));
        const rows = await cmd.func({ query: 'json', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1, id: 'Newtonsoft.Json', version: '13.0.3', verified: true,
            authors: 'James Newton-King', tags: 'json',
            url: 'https://www.nuget.org/packages/Newtonsoft.Json',
        });
    });
});

describe('nuget package adapter', () => {
    const cmd = getRegistry().get('nuget/package');

    it('rejects malformed package ids before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ id: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ id: 'has space' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ id: '.starts-with-dot' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
        await expect(cmd.func({ id: 'No.Such.Package.1234' })).rejects.toThrow(EmptyResultError);
    });

    it('flattens inline registration pages and sorts versions newest-first', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            items: [
                {
                    items: [
                        { catalogEntry: { id: 'Newtonsoft.Json', version: '13.0.3', authors: ['JNK'], tags: ['json'], licenseExpression: 'MIT', published: '2023-03-08T20:00:00Z', listed: true } },
                        { catalogEntry: { id: 'Newtonsoft.Json', version: '12.0.0', authors: ['JNK'], tags: ['json'], licenseExpression: 'MIT', published: '2018-01-17T20:00:00Z', listed: true } },
                    ],
                },
            ],
        }), { status: 200 })));
        const rows = await cmd.func({ id: 'Newtonsoft.Json' });
        expect(rows.map((r) => r.version)).toEqual(['13.0.3', '12.0.0']);
        expect(rows[0]).toMatchObject({
            rank: 1, id: 'Newtonsoft.Json', version: '13.0.3', authors: 'JNK', tags: 'json',
            licenseExpression: 'MIT', listed: true,
            url: 'https://www.nuget.org/packages/Newtonsoft.Json/13.0.3',
        });
    });
});
