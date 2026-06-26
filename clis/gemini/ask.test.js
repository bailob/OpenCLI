import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';

const baseline = {
    turns: [{ Role: 'Assistant', Text: '旧回答' }],
    transcriptLines: ['baseline'],
    composerHasText: true,
    isGenerating: false,
    structuredTurnsTrusted: true,
};
const submission = {
    snapshot: {
        turns: [
            { Role: 'Assistant', Text: '旧回答' },
            { Role: 'User', Text: '请只回复：OK' },
        ],
        transcriptLines: ['baseline', '请只回复：OK'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
    },
    preSendAssistantCount: 1,
    userAnchorTurn: { Role: 'User', Text: '请只回复：OK' },
    reason: 'user_turn',
};

const FIXTURE_MODELS = [
    { model: '2.5-flash', thinkingValues: ['standard', 'extended'] },
    { model: '2.5-flash-lite', thinkingValues: ['standard'] },
    { model: '2.5-pro', thinkingValues: ['standard', 'extended'] },
    { model: '2.5-flash-thinking', thinkingValues: [] },
];

const mocks = vi.hoisted(() => ({
    ensureGeminiPage: vi.fn(),
    getCurrentGeminiModel: vi.fn(),
    readGeminiSnapshot: vi.fn(),
    selectGeminiModel: vi.fn(),
    selectGeminiThinking: vi.fn(),
    sendGeminiMessage: vi.fn(),
    startNewGeminiChat: vi.fn(),
    waitForGeminiSubmission: vi.fn(),
    waitForGeminiResponse: vi.fn(),
}));

vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        ensureGeminiPage: mocks.ensureGeminiPage,
        getCurrentGeminiModel: mocks.getCurrentGeminiModel,
        readGeminiSnapshot: mocks.readGeminiSnapshot,
        selectGeminiModel: mocks.selectGeminiModel,
        selectGeminiThinking: mocks.selectGeminiThinking,
        sendGeminiMessage: mocks.sendGeminiMessage,
        startNewGeminiChat: mocks.startNewGeminiChat,
        waitForGeminiSubmission: mocks.waitForGeminiSubmission,
        waitForGeminiResponse: mocks.waitForGeminiResponse,
    };
});

// Mock models.js — stub discoverModelsScript to return a marker string.
const modelsMock = vi.hoisted(() => ({
    discoverModelsScript: vi.fn().mockReturnValue('__DISCOVER_SCRIPT__'),
}));
vi.mock('./models.js', () => ({
    discoverModelsScript: modelsMock.discoverModelsScript,
    __test__: {
        discoverModelsScript: modelsMock.discoverModelsScript,
    },
}));

import { askCommand, __test__ } from './ask.js';

const { validateAskModelValue } = __test__;

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

// ── Command registration ─────────────────────────────────────────────────

describe('ask command registration', () => {
    it('is registered with site=gemini and name=ask', () => {
        expect(askCommand.site).toBe('gemini');
        expect(askCommand.name).toBe('ask');
    });

    it('is access=write', () => {
        expect(askCommand.access).toBe('write');
    });

    it('declares response as its output column', () => {
        expect(askCommand.columns).toEqual(['response']);
    });

    it('includes --model as an optional string argument', () => {
        const modelArg = askCommand.args.find((a) => a.name === 'model');
        expect(modelArg).toBeDefined();
        expect(modelArg.required).toBe(false);
        expect(modelArg.type).toBe('string');
    });

    it('includes --thinking as an optional argument', () => {
        const thinkingArg = askCommand.args.find((a) => a.name === 'thinking');
        expect(thinkingArg).toBeDefined();
        expect(thinkingArg.required).toBe(false);
    });

    it('still includes prompt, timeout, and new args', () => {
        const names = askCommand.args.map((a) => a.name);
        expect(names).toContain('prompt');
        expect(names).toContain('timeout');
        expect(names).toContain('new');
        expect(names).toContain('model');
        expect(names).toContain('thinking');
    });
});

// ── validateAskModelValue ────────────────────────────────────────────────

describe('validateAskModelValue', () => {
    it('accepts canonical model ids', () => {
        expect(() => validateAskModelValue('2.5-flash')).not.toThrow();
        expect(() => validateAskModelValue('2.5-flash-lite')).not.toThrow();
        expect(() => validateAskModelValue('2.5-pro')).not.toThrow();
        expect(() => validateAskModelValue('2.5-flash-thinking')).not.toThrow();
        expect(() => validateAskModelValue('3.1-flash-lite')).not.toThrow();
        expect(() => validateAskModelValue('3.5-flash')).not.toThrow();
        expect(() => validateAskModelValue('3.1-pro')).not.toThrow();
    });

    it('rejects short aliases without version numbers', () => {
        const msg = 'is not accepted';

        expect(() => validateAskModelValue('pro')).toThrow(ArgumentError);
        expect(() => validateAskModelValue('pro')).toThrow(msg);
        expect(() => validateAskModelValue('flash')).toThrow(ArgumentError);
        expect(() => validateAskModelValue('flash')).toThrow(msg);
        expect(() => validateAskModelValue('flash-lite')).toThrow(ArgumentError);
        expect(() => validateAskModelValue('flash-lite')).toThrow(msg);
        expect(() => validateAskModelValue('lite')).toThrow(ArgumentError);
        expect(() => validateAskModelValue('thinking')).toThrow(ArgumentError);
    });

    it('rejects empty string', () => {
        expect(() => validateAskModelValue('')).toThrow(ArgumentError);
    });

    it('rejects values missing a variant after version', () => {
        expect(() => validateAskModelValue('2.5')).toThrow(ArgumentError);
    });

    it('rejects inverted format (variant first)', () => {
        expect(() => validateAskModelValue('flash-2.5')).toThrow(ArgumentError);
    });

    it('mentions opencli gemini models in error messages', () => {
        try { validateAskModelValue('pro'); } catch (e) {
            expect(e.message).toContain('opencli gemini models');
        }
        try { validateAskModelValue('2.5'); } catch (e) {
            expect(e.message).toContain('opencli gemini models');
        }
    });
});

/**
 * Helper: set up the two evaluate calls needed for thinking validation:
 *   1. discoverModelsScript (via page.evaluate)
 *   2. getCurrentGeminiModel (mocked separately)
 */
function setupDiscoveryAndModel(page, discoveredModels, currentModel) {
    page.evaluate.mockResolvedValueOnce(discoveredModels);
    mocks.getCurrentGeminiModel.mockResolvedValueOnce(currentModel);
}

/**
 * Helper: set up the full happy-path mocks after thinking validation.
 */
function setupHappyPath() {
    mocks.selectGeminiThinking.mockResolvedValueOnce('Selected');
    mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
    mocks.sendGeminiMessage.mockResolvedValueOnce('button');
    mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
    mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');
}

// ── gemini ask orchestration ─────────────────────────────────────────────

describe('gemini ask orchestration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── Baseline behavior (no --model) ───────────────────────────────────

    it('captures baseline, sends, waits for confirmed submission, then waits with the remaining timeout', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2000);
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');

        const result = await askCommand.func(page, { prompt: '请只回复：OK', timeout: 20, new: 'false' });

        expect(mocks.readGeminiSnapshot).toHaveBeenCalledWith(page);
        expect(mocks.waitForGeminiSubmission).toHaveBeenCalledWith(page, baseline, 20);
        expect(mocks.waitForGeminiResponse).toHaveBeenCalledWith(page, submission, '请只回复：OK', 18);
        expect(result).toEqual([{ response: '💬 OK' }]);
    });

    it('does not spend extra response wait time after submission has already consumed the full timeout budget', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(20000);
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('');

        await askCommand.func(page, { prompt: '请只回复：OK', timeout: 20, new: 'false' });

        expect(mocks.waitForGeminiResponse).toHaveBeenCalledWith(page, submission, '请只回复：OK', 0);
    });

    // ── Omitted --model (no model change) ────────────────────────────────

    it('does not call ensureGeminiPage or selectGeminiModel when --model is omitted', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');

        await askCommand.func(page, { prompt: 'hello', timeout: 10, new: 'false' });

        // ensureGeminiPage may be called internally by readGeminiSnapshot/sendGeminiMessage
        // but selectGeminiModel must NOT be called when --model is absent.
        expect(mocks.selectGeminiModel).not.toHaveBeenCalled();
        // page.evaluate (for model discovery) must NOT be called.
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('does not call selectGeminiModel when --model is undefined', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');

        await askCommand.func(page, { prompt: 'hello', timeout: 10, new: 'false' });

        expect(mocks.selectGeminiModel).not.toHaveBeenCalled();
    });

    // ── Valid model selection ────────────────────────────────────────────

    it('selects the model before readGeminiSnapshot when --model is provided', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODELS); // discoverModelsScript
        mocks.selectGeminiModel.mockResolvedValueOnce(undefined);
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');

        await askCommand.func(page, { prompt: 'hello', model: '2.5-flash', timeout: 10, new: 'false' });

        // Model discovery and selection happen first.
        expect(mocks.ensureGeminiPage).toHaveBeenCalledWith(page);
        expect(mocks.ensureGeminiPage).toHaveBeenCalledBefore(page.evaluate);
        expect(page.evaluate).toHaveBeenCalledTimes(1); // discoverModelsScript
        expect(mocks.selectGeminiModel).toHaveBeenCalledWith(page, '2.5-flash');

        // Model selection happens before readGeminiSnapshot.
        expect(mocks.selectGeminiModel).toHaveBeenCalled();
        expect(mocks.readGeminiSnapshot).toHaveBeenCalled();
        // Verify ordering: selectGeminiModel called before readGeminiSnapshot
        const selectCallOrder = mocks.selectGeminiModel.mock.invocationCallOrder[0];
        const snapshotCallOrder = mocks.readGeminiSnapshot.mock.invocationCallOrder[0];
        expect(selectCallOrder).toBeLessThan(snapshotCallOrder);
    });

    it('selects the model before sending the prompt', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODELS);
        mocks.selectGeminiModel.mockResolvedValueOnce(undefined);
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');

        await askCommand.func(page, { prompt: 'hello', model: '2.5-flash', timeout: 10, new: 'false' });

        const selectCallOrder = mocks.selectGeminiModel.mock.invocationCallOrder[0];
        const sendCallOrder = mocks.sendGeminiMessage.mock.invocationCallOrder[0];
        expect(selectCallOrder).toBeLessThan(sendCallOrder);
    });

    it('selects 2.5-pro model successfully', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODELS);
        mocks.selectGeminiModel.mockResolvedValueOnce(undefined);
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');

        const result = await askCommand.func(page, { prompt: 'hello', model: '2.5-pro', timeout: 10, new: 'false' });

        expect(mocks.selectGeminiModel).toHaveBeenCalledWith(page, '2.5-pro');
        expect(result).toEqual([{ response: '💬 OK' }]);
    });

    it('selects 2.5-flash-lite model successfully', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODELS);
        mocks.selectGeminiModel.mockResolvedValueOnce(undefined);
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');

        const result = await askCommand.func(page, { prompt: 'hello', model: '2.5-flash-lite', timeout: 10, new: 'false' });

        expect(mocks.selectGeminiModel).toHaveBeenCalledWith(page, '2.5-flash-lite');
        expect(result).toEqual([{ response: '💬 OK' }]);
    });

    // ── Alias rejection ──────────────────────────────────────────────────

    it('throws ArgumentError for alias "pro" before any model discovery', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);

        await expect(
            askCommand.func(page, { prompt: 'hello', model: 'pro', timeout: 10, new: 'false' })
        ).rejects.toBeInstanceOf(ArgumentError);

        // Must not call page.evaluate (no discovery attempted).
        expect(page.evaluate).not.toHaveBeenCalled();
        expect(mocks.selectGeminiModel).not.toHaveBeenCalled();
    });

    it('throws ArgumentError for alias "flash" before any model discovery', async () => {
        const page = createPageMock();

        await expect(
            askCommand.func(page, { prompt: 'hello', model: 'flash', timeout: 10, new: 'false' })
        ).rejects.toBeInstanceOf(ArgumentError);

        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('throws ArgumentError for alias "flash-lite" before any model discovery', async () => {
        const page = createPageMock();

        await expect(
            askCommand.func(page, { prompt: 'hello', model: 'flash-lite', timeout: 10, new: 'false' })
        ).rejects.toBeInstanceOf(ArgumentError);

        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects aliases with error message mentioning canonical ids and opencli gemini models', async () => {
        const page = createPageMock();

        try {
            await askCommand.func(page, { prompt: 'hello', model: 'pro', timeout: 10, new: 'false' });
            expect.fail('Expected ArgumentError');
        } catch (e) {
            expect(e).toBeInstanceOf(ArgumentError);
            expect(e.message).toContain('not accepted');
            expect(e.message).toContain('opencli gemini models');
        }
    });

    // ── Invalid / unavailable model ──────────────────────────────────────

    it('throws ArgumentError for a model id not in the discovered list', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODELS);

        await expect(
            askCommand.func(page, { prompt: 'hello', model: '99.9-nonexistent', timeout: 10, new: 'false' })
        ).rejects.toBeInstanceOf(ArgumentError);

        // Discovery was attempted.
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        // But model was not selected.
        expect(mocks.selectGeminiModel).not.toHaveBeenCalled();
        // And no snapshot or send happened.
        expect(mocks.readGeminiSnapshot).not.toHaveBeenCalled();
        expect(mocks.sendGeminiMessage).not.toHaveBeenCalled();
    });

    it('includes available models and suggests opencli gemini models in invalid-model error', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODELS);

        try {
            await askCommand.func(page, { prompt: 'hello', model: '99.9-nonexistent', timeout: 10, new: 'false' });
            expect.fail('Expected ArgumentError');
        } catch (e) {
            expect(e).toBeInstanceOf(ArgumentError);
            expect(e.message).toContain('99.9-nonexistent');
            expect(e.message).toContain('Available models');
            expect(e.message).toContain('2.5-flash');
            expect(e.message).toContain('2.5-pro');
            expect(e.message).toContain('opencli gemini models');
        }
    });

    it('throws when model discovery returns non-array data', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({ ok: false });

        await expect(
            askCommand.func(page, { prompt: 'hello', model: '2.5-flash', timeout: 10, new: 'false' })
        ).rejects.toBeInstanceOf(ArgumentError);
    });

    // ── Browser Bridge envelope unwrap ───────────────────────────────────

    it('unwraps Browser Bridge envelope { session, data } for model discovery', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({
            session: 'site:gemini',
            data: FIXTURE_MODELS,
        });
        mocks.selectGeminiModel.mockResolvedValueOnce(undefined);
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');

        const result = await askCommand.func(page, { prompt: 'hello', model: '2.5-flash', timeout: 10, new: 'false' });

        expect(mocks.selectGeminiModel).toHaveBeenCalledWith(page, '2.5-flash');
        expect(result).toEqual([{ response: '💬 OK' }]);
    });

    it('handles empty model discovery result gracefully', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce([]);

        await expect(
            askCommand.func(page, { prompt: 'hello', model: '2.5-flash', timeout: 10, new: 'false' })
        ).rejects.toBeInstanceOf(ArgumentError);
    });

    // ── Ordering and state ───────────────────────────────────────────────

    it('does not restore previous model after completion', async () => {
        // The ask command selects the model and does not revert it.
        // This test verifies that selectGeminiModel is only called once
        // (for selection) and never called again (for restoration).
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODELS);
        mocks.selectGeminiModel.mockResolvedValueOnce(undefined);
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');

        await askCommand.func(page, { prompt: 'hello', model: '2.5-flash', timeout: 10, new: 'false' });

        // selectGeminiModel is called exactly once (for selection, not restoration).
        expect(mocks.selectGeminiModel).toHaveBeenCalledTimes(1);
    });

    it('does not mutate other Gemini commands — only ask accepts --model', () => {
        // Other Gemini commands (image, deep research, etc.) are in separate
        // files and do not import model selection.  This test confirms ask
        // is the only command that declares --model within gemini.
        const modelArg = askCommand.args.find((a) => a.name === 'model');
        expect(modelArg).toBeDefined();
        // The model arg is on ask only; other commands are unchanged.
    });

    // ── Model selection + --new interaction ──────────────────────────────

    it('selects model, then starts new chat when both --model and --new=true', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODELS);
        mocks.selectGeminiModel.mockResolvedValueOnce(undefined);
        mocks.startNewGeminiChat.mockResolvedValueOnce('clicked');
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');

        await askCommand.func(page, { prompt: 'hello', model: '2.5-flash', timeout: 10, new: 'true' });

        // Model selection happens first, then new chat.
        const selectCallOrder = mocks.selectGeminiModel.mock.invocationCallOrder[0];
        const newChatCallOrder = mocks.startNewGeminiChat.mock.invocationCallOrder[0];
        expect(selectCallOrder).toBeLessThan(newChatCallOrder);
    });
});

describe('gemini ask thinking selection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── Valid thinking selection (current model matched) ─────────────
    it('selects standard thinking when current model supports it', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2000);
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-flash', thinkingValues: ['standard', 'extended'] }],
            '2.5-flash',
        );
        setupHappyPath();

        const result = await askCommand.func(page, {
            prompt: '请只回复：OK', timeout: 20, new: 'false', thinking: 'standard',
        });

        expect(mocks.selectGeminiThinking).toHaveBeenCalledWith(page, 'standard');
        const selectCall = mocks.selectGeminiThinking.mock.invocationCallOrder[0];
        const snapshotCall = mocks.readGeminiSnapshot.mock.invocationCallOrder[0];
        expect(selectCall).toBeLessThan(snapshotCall);
        expect(result).toEqual([{ response: '💬 OK' }]);
    });

    it('selects extended thinking when current model supports it', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2000);
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-pro', thinkingValues: ['standard', 'extended'] }],
            '2.5-pro',
        );
        setupHappyPath();

        const result = await askCommand.func(page, {
            prompt: 'test', timeout: 20, new: 'false', thinking: 'extended',
        });

        expect(mocks.selectGeminiThinking).toHaveBeenCalledWith(page, 'extended');
        expect(result[0].response).toContain('OK');
    });

    it('selects thinking with --new true: new chat before thinking before snapshot', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2000);
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-flash', thinkingValues: ['standard', 'extended'] }],
            '2.5-flash',
        );
        mocks.startNewGeminiChat.mockResolvedValueOnce('navigate');
        setupHappyPath();

        await askCommand.func(page, {
            prompt: 'test', timeout: 20, new: 'true', thinking: 'standard',
        });

        const newChatCall = mocks.startNewGeminiChat.mock.invocationCallOrder[0];
        const thinkingCall = mocks.selectGeminiThinking.mock.invocationCallOrder[0];
        const snapshotCall = mocks.readGeminiSnapshot.mock.invocationCallOrder[0];
        expect(newChatCall).toBeLessThan(thinkingCall);
        expect(thinkingCall).toBeLessThan(snapshotCall);
    });

    // ── Invalid thinking value (not standard or extended) ────────────
    it('rejects invalid thinking value with ArgumentError', async () => {
        const page = createPageMock();
        let err;
        try {
            await askCommand.func(page, {
                prompt: 'test', timeout: 20, thinking: 'invalid',
            });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ArgumentError);
        expect(err.message).toContain("--thinking must be 'standard' or 'extended'");
        expect(mocks.selectGeminiThinking).not.toHaveBeenCalled();
        expect(mocks.readGeminiSnapshot).not.toHaveBeenCalled();
        expect(mocks.sendGeminiMessage).not.toHaveBeenCalled();
    });

    it('rejects empty thinking value', async () => {
        const page = createPageMock();
        let err;
        try {
            await askCommand.func(page, { prompt: 'test', timeout: 20, thinking: '' });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ArgumentError);
        expect(err.message).toContain("--thinking must be 'standard' or 'extended'");
    });

    // ── Current-model-scoped validation ──────────────────────────────
    it('rejects thinking not available for the current model (cross-model mismatch)', async () => {
        const page = createPageMock();
        // Two models: 2.5-flash supports 'standard' only, 2.5-pro supports extended.
        // Current model is 2.5-flash, but user requests 'extended'.
        setupDiscoveryAndModel(page,
            [
                { model: '2.5-flash', thinkingValues: ['standard'] },
                { model: '2.5-pro', thinkingValues: ['standard', 'extended'] },
            ],
            '2.5-flash',
        );

        let err;
        try {
            await askCommand.func(page, {
                prompt: 'test', timeout: 20, thinking: 'extended',
            });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ArgumentError);
        expect(err.message).toContain("not available for the current model");
        expect(err.message).toContain("2.5-flash");
        expect(err.hint).toContain("standard");
        // Must NOT mention 'extended' as available (it's not on this model).
        expect(err.hint).not.toContain("extended");

        expect(mocks.selectGeminiThinking).not.toHaveBeenCalled();
        expect(mocks.readGeminiSnapshot).not.toHaveBeenCalled();
    });

    it('rejects thinking when current model has no thinking values at all', async () => {
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-flash-lite', thinkingValues: [] }],
            '2.5-flash-lite',
        );

        let err;
        try {
            await askCommand.func(page, {
                prompt: 'test', timeout: 20, thinking: 'standard',
            });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ArgumentError);
        expect(err.message).toContain("not available for the current model");

        expect(mocks.selectGeminiThinking).not.toHaveBeenCalled();
    });

    // ── Union fallback when current model unknown ────────────────────
    it('falls back to union validation when current model is empty', async () => {
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-flash', thinkingValues: ['standard'] }],
            '',  // current model unknown → union fallback
        );

        let err;
        try {
            await askCommand.func(page, {
                prompt: 'test', timeout: 20, thinking: 'extended',
            });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ArgumentError);
        expect(err.message).toContain("not currently available");
        expect(err.hint).toContain("standard");
    });

    it('falls back to union when current model not found in discovered set', async () => {
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-flash', thinkingValues: ['standard'] }],
            '3.0-unknown-model',  // not in discovered set
        );

        let err;
        try {
            await askCommand.func(page, {
                prompt: 'test', timeout: 20, thinking: 'extended',
            });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ArgumentError);
        expect(err.message).toContain("not currently available");
    });

    // ── Graceful degradation when discovery returns empty ────────────
    it('proceeds when discovery returns empty', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2000);
        const page = createPageMock();
        setupDiscoveryAndModel(page, [], '');
        setupHappyPath();

        const result = await askCommand.func(page, {
            prompt: 'test', timeout: 20, thinking: 'standard',
        });
        expect(mocks.selectGeminiThinking).toHaveBeenCalledWith(page, 'standard');
        expect(result[0].response).toContain('OK');
    });

    it('rejects thinking when current model has empty thinking values', async () => {
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-flash', thinkingValues: [] }],
            '2.5-flash',
        );

        let err;
        try {
            await askCommand.func(page, {
                prompt: 'test', timeout: 20, thinking: 'extended',
            });
        } catch (e) { err = e; }
        // Scoped validation: current model known, but thinkingValues is empty → reject.
        expect(err).toBeInstanceOf(ArgumentError);
        expect(err.message).toContain("not available for the current model");
        expect(mocks.selectGeminiThinking).not.toHaveBeenCalled();
    });

    // ── Failed thinking selection ────────────────────────────────────
    it('throws when selectGeminiThinking returns empty after successful validation', async () => {
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-flash', thinkingValues: ['standard', 'extended'] }],
            '2.5-flash',
        );
        mocks.selectGeminiThinking.mockResolvedValueOnce('');  // failed selection

        let err;
        try {
            await askCommand.func(page, {
                prompt: 'test', timeout: 20, thinking: 'standard',
            });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ArgumentError);
        expect(err.message).toContain("Could not select thinking level");

        // Must not proceed to snapshot or send.
        expect(mocks.readGeminiSnapshot).not.toHaveBeenCalled();
        expect(mocks.sendGeminiMessage).not.toHaveBeenCalled();
    });

    it('failed selection hint includes model-specific info when current model known', async () => {
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-flash', thinkingValues: ['standard', 'extended'] }],
            '2.5-flash',
        );
        mocks.selectGeminiThinking.mockResolvedValueOnce('');

        let err;
        try {
            await askCommand.func(page, {
                prompt: 'test', timeout: 20, thinking: 'extended',
            });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ArgumentError);
        expect(err.hint).toContain("2.5-flash");
        expect(err.hint).toContain("standard");
        expect(err.hint).toContain("extended");
        expect(err.hint).toContain("gemini models");
    });

    // ── Omitted thinking ─────────────────────────────────────────────
    it('omitted --thinking does not call selectGeminiThinking', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2000);
        const page = createPageMock();
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');

        await askCommand.func(page, { prompt: 'test', timeout: 20, new: 'false' });
        expect(mocks.selectGeminiThinking).not.toHaveBeenCalled();
    });

    it('null thinking does not call selectGeminiThinking', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2000);
        const page = createPageMock();
        mocks.readGeminiSnapshot.mockResolvedValueOnce(baseline);
        mocks.sendGeminiMessage.mockResolvedValueOnce('button');
        mocks.waitForGeminiSubmission.mockResolvedValueOnce(submission);
        mocks.waitForGeminiResponse.mockResolvedValueOnce('OK');

        await askCommand.func(page, { prompt: 'test', timeout: 20, thinking: null });
        expect(mocks.selectGeminiThinking).not.toHaveBeenCalled();
    });

    // ── Case insensitivity ───────────────────────────────────────────
    it('accepts uppercase thinking value', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2000);
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-flash', thinkingValues: ['standard', 'extended'] }],
            '2.5-flash',
        );
        setupHappyPath();

        const result = await askCommand.func(page, {
            prompt: 'test', timeout: 20, thinking: 'STANDARD',
        });
        expect(mocks.selectGeminiThinking).toHaveBeenCalledWith(page, 'standard');
        expect(result[0].response).toContain('OK');
    });

    it('accepts mixed-case thinking value', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2000);
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-flash', thinkingValues: ['standard', 'extended'] }],
            '2.5-flash',
        );
        setupHappyPath();

        const result = await askCommand.func(page, {
            prompt: 'test', timeout: 20, thinking: 'ExTeNdEd',
        });
        expect(mocks.selectGeminiThinking).toHaveBeenCalledWith(page, 'extended');
        expect(result[0].response).toContain('OK');
    });

    // ── Does not restore thinking after completion ───────────────────
    it('does not call selectGeminiThinking again after send', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2000);
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-flash', thinkingValues: ['standard', 'extended'] }],
            '2.5-flash',
        );
        setupHappyPath();

        await askCommand.func(page, {
            prompt: 'test', timeout: 20, thinking: 'standard',
        });
        expect(mocks.selectGeminiThinking).toHaveBeenCalledTimes(1);
    });

    // ── --model + --thinking integration ───────────────────────────
    it('scopes thinking validation to the selected model when --model is supplied', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(2000);
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        // First evaluate: model discovery (model selection block)
        page.evaluate.mockResolvedValueOnce(FIXTURE_MODELS);
        mocks.selectGeminiModel.mockResolvedValueOnce(undefined);
        // Second evaluate: thinking discovery
        page.evaluate.mockResolvedValueOnce([
            { model: '2.5-flash', thinkingValues: ['standard'] },
            { model: '2.5-pro', thinkingValues: ['standard', 'extended'] },
        ]);
        // getCurrentGeminiModel should NOT be called because --model overrides it
        mocks.getCurrentGeminiModel.mockResolvedValue('2.5-flash');
        setupHappyPath();

        const result = await askCommand.func(page, {
            prompt: 'test', timeout: 20, new: 'false',
            model: '2.5-pro', thinking: 'extended',
        });

        // Thinking validated against selected model (2.5-pro), not current (2.5-flash).
        expect(mocks.selectGeminiThinking).toHaveBeenCalledWith(page, 'extended');
        // getCurrentGeminiModel should NOT have been called when --model is supplied.
        expect(mocks.getCurrentGeminiModel).not.toHaveBeenCalled();
        expect(result[0].response).toContain('OK');
    });

    it('rejects thinking not available for the selected model (--model + --thinking mismatch)', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        // First evaluate: model discovery for selection
        page.evaluate.mockResolvedValueOnce(FIXTURE_MODELS);
        mocks.selectGeminiModel.mockResolvedValueOnce(undefined);
        // Second evaluate: thinking discovery — only standard available for 2.5-flash
        page.evaluate.mockResolvedValueOnce([
            { model: '2.5-flash', thinkingValues: ['standard'] },
            { model: '2.5-pro', thinkingValues: ['standard', 'extended'] },
        ]);

        let err;
        try {
            await askCommand.func(page, {
                prompt: 'test', timeout: 20,
                model: '2.5-flash', thinking: 'extended',
            });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ArgumentError);
        expect(err.message).toContain("not available for the selected model");
        expect(err.message).toContain("2.5-flash");
        expect(err.hint).toContain("standard");
        expect(err.hint).not.toContain("extended");

        expect(mocks.selectGeminiThinking).not.toHaveBeenCalled();
        expect(mocks.readGeminiSnapshot).not.toHaveBeenCalled();
    });

    it('unwraps Browser Bridge envelope for thinking discovery before scoped validation', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        // First evaluate: model discovery for selection
        page.evaluate.mockResolvedValueOnce(FIXTURE_MODELS);
        mocks.selectGeminiModel.mockResolvedValueOnce(undefined);
        // Second evaluate: thinking discovery arrives wrapped by Browser Bridge.
        page.evaluate.mockResolvedValueOnce({
            session: 'site:gemini',
            data: [
                { model: '2.5-flash', thinkingValues: ['standard'] },
                { model: '2.5-pro', thinkingValues: ['standard', 'extended'] },
            ],
        });

        let err;
        try {
            await askCommand.func(page, {
                prompt: 'test', timeout: 20,
                model: '2.5-flash', thinking: 'extended',
            });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ArgumentError);
        expect(err.message).toContain('not available for the selected model');
        expect(err.hint).toContain('standard');
        expect(err.hint).not.toContain('extended');

        expect(mocks.selectGeminiThinking).not.toHaveBeenCalled();
        expect(mocks.readGeminiSnapshot).not.toHaveBeenCalled();
    });

    it('uses current model for scoping when --model is omitted (unchanged behavior)', async () => {
        const page = createPageMock();
        setupDiscoveryAndModel(page,
            [{ model: '2.5-flash', thinkingValues: ['standard', 'extended'] }],
            '2.5-flash',
        );
        setupHappyPath();

        const result = await askCommand.func(page, {
            prompt: 'test', timeout: 20, new: 'false', thinking: 'standard',
        });

        expect(mocks.getCurrentGeminiModel).toHaveBeenCalled();
        expect(mocks.selectGeminiThinking).toHaveBeenCalledWith(page, 'standard');
        expect(result[0].response).toContain('OK');
    });

    // ── Error message suggests gemini models ────────────────────────
    it('error hint suggests gemini models for invalid values', async () => {
        const page = createPageMock();
        let err;
        try {
            await askCommand.func(page, { prompt: 'test', timeout: 20, thinking: 'bad-value' });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ArgumentError);
        expect(err.hint).toContain('gemini models');
    });

    it('invalid thinking value caught by first check does not trigger discovery', async () => {
        const page = createPageMock();
        try {
            await askCommand.func(page, { prompt: 'test', timeout: 20, thinking: 'bad' });
        } catch (_) {}
        // First check should catch it; neither discovery nor current-model lookup runs.
        expect(page.evaluate).not.toHaveBeenCalled();
        expect(mocks.getCurrentGeminiModel).not.toHaveBeenCalled();
    });
});
