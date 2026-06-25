import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const mocks = vi.hoisted(() => ({
    ensureGeminiPage: vi.fn(),
}));

vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        ensureGeminiPage: mocks.ensureGeminiPage,
    };
});

import { modelsCommand } from './models.js';

function createPageMock() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(),
        getCookies: vi.fn().mockResolvedValue([]),
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({}),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(''),
        nativeType: vi.fn().mockResolvedValue(undefined),
        nativeKeyPress: vi.fn().mockResolvedValue(undefined),
    };
}

const FIXTURE_MODEL_ROWS = [
    { model: '2.5-flash', thinkingValues: ['standard', 'extended'] },
    { model: '2.5-flash-lite', thinkingValues: ['standard'] },
    { model: '2.5-pro', thinkingValues: ['standard', 'extended'] },
    { model: '2.5-flash-thinking', thinkingValues: [] },
];

describe('gemini models', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns model rows with model and thinkingValues columns', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODEL_ROWS);

        const rows = await modelsCommand.func(page);

        expect(rows).toEqual(FIXTURE_MODEL_ROWS);
        expect(rows[0]).toHaveProperty('model');
        expect(rows[0]).toHaveProperty('thinkingValues');
        expect(Array.isArray(rows[0].thinkingValues)).toBe(true);
    });

    it('calls ensureGeminiPage before discovery', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODEL_ROWS);

        await modelsCommand.func(page);

        expect(mocks.ensureGeminiPage).toHaveBeenCalledWith(page);
        expect(mocks.ensureGeminiPage).toHaveBeenCalledBefore(page.evaluate);
    });

    it('is read-only: does not start a new chat, send a message, or select a model', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODEL_ROWS);

        await modelsCommand.func(page);

        // ensureGeminiPage always gets called, but no other stateful utils.
        expect(mocks.ensureGeminiPage).toHaveBeenCalledTimes(1);
        // evaluate is called exactly once for the discovery script.
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('unwraps Browser Bridge envelope { session, data }', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({
            session: 'site:gemini',
            data: FIXTURE_MODEL_ROWS,
        });

        const rows = await modelsCommand.func(page);

        expect(rows).toEqual(FIXTURE_MODEL_ROWS);
    });

    it('returns empty array when no model picker is found (empty evaluate result)', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce([]);

        const rows = await modelsCommand.func(page);

        expect(rows).toEqual([]);
    });

    it('throws CommandExecutionError when evaluate returns a non-array result', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({ ok: false });

        await expect(modelsCommand.func(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError when a row is missing the model field', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce([
            { thinkingValues: ['standard'] },
        ]);

        await expect(modelsCommand.func(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError when a row has a non-array thinkingValues field', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce([
            { model: '2.5-flash', thinkingValues: 'standard' },
        ]);

        await expect(modelsCommand.func(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('accepts rows with empty thinkingValues array', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce([
            { model: '2.5-flash', thinkingValues: [] },
            { model: '2.5-pro', thinkingValues: [] },
        ]);

        const rows = await modelsCommand.func(page);

        expect(rows).toHaveLength(2);
        expect(rows[0].thinkingValues).toEqual([]);
        expect(rows[1].thinkingValues).toEqual([]);
    });

    it('keeps model values as strings and thinkingValues as string arrays', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce([
            { model: '2.5-flash-lite', thinkingValues: ['standard'] },
            { model: '2.5-pro', thinkingValues: ['standard', 'extended'] },
        ]);

        const rows = await modelsCommand.func(page);

        for (const row of rows) {
            expect(typeof row.model).toBe('string');
            expect(Array.isArray(row.thinkingValues)).toBe(true);
            for (const tv of row.thinkingValues) {
                expect(typeof tv).toBe('string');
            }
        }
    });
});

describe('gemini models command registration', () => {
    it('is registered with site=gemini and name=models', () => {
        expect(modelsCommand.site).toBe('gemini');
        expect(modelsCommand.name).toBe('models');
    });

    it('is access=read (not write)', () => {
        expect(modelsCommand.access).toBe('read');
    });

    it('declares model and thinkingValues as its output columns', () => {
        expect(modelsCommand.columns).toEqual(['model', 'thinkingValues']);
    });

    it('has no CLI arguments', () => {
        expect(modelsCommand.args).toEqual([]);
    });

    it('is a browser command', () => {
        expect(modelsCommand.browser).toBe(true);
    });

    it('targets gemini.google.com', () => {
        expect(modelsCommand.domain).toBe('gemini.google.com');
    });
});
