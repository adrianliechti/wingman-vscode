import * as assert from 'assert';

import { selectUtilityModels, toCustomEndpointModels } from '../models';

suite('Utility model selection', () => {
	test('prefers medium and small models in catalog order, independently of backend order', () => {
		assert.deepStrictEqual(selectUtilityModels([
			'claude-haiku-4-6', 'gpt-6-astra', 'claude-sonnet-5', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra',
		]), {
			utilityModel: 'gpt-5.6-terra',
			utilitySmallModel: 'gpt-5.6-luna',
		});
	});

	test('prefers GPT 6 Luna over GPT 5.6 Luna for small utilities', () => {
		assert.deepStrictEqual(selectUtilityModels(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-luna', 'gpt-6-sol']), {
			utilityModel: 'gpt-5.6-terra',
			utilitySmallModel: 'gpt-6-luna',
		});
	});

	test('uses catalog classes and reported aliases for fallback models', () => {
		assert.deepStrictEqual(selectUtilityModels(['gemini-3.5-flash', 'gemini-3-flash-preview']), {
			utilityModel: 'gemini-3.5-flash',
			utilitySmallModel: 'gemini-3-flash-preview',
		});
	});

	test('shares a medium model when no small model is available', () => {
		assert.deepStrictEqual(selectUtilityModels(['gpt-6-astra', 'claude-sonnet-5']), {
			utilityModel: 'claude-sonnet-5',
			utilitySmallModel: 'claude-sonnet-5',
		});
	});

	test('falls back to a small model before a large model for general utilities', () => {
		assert.deepStrictEqual(selectUtilityModels(['gpt-6-astra', 'claude-haiku-4-6']), {
			utilityModel: 'claude-haiku-4-6',
			utilitySmallModel: 'claude-haiku-4-6',
		});
	});

	test('uses a large model when it is the only supported option', () => {
		assert.deepStrictEqual(selectUtilityModels(['unknown-model', 'gpt-6-astra']), {
			utilityModel: 'gpt-6-astra',
			utilitySmallModel: 'gpt-6-astra',
		});
		assert.strictEqual(selectUtilityModels(['unknown-model']), undefined);
		assert.strictEqual(selectUtilityModels([]), undefined);
	});

	test('keeps class metadata out of the provider configuration', () => {
		const { models } = toCustomEndpointModels(['gpt-5.6-terra', 'gpt-5.6-luna'], 'http://localhost/v1');
		assert.strictEqual(models.length, 2);
		assert.ok(models.every(model => !Object.hasOwn(model, 'class')));
	});

	test('forwards vendor limits verbatim and reports unknown ids', () => {
		const { models, unmatched } = toCustomEndpointModels(['claude-opus-5', 'gemini-3-flash', 'unknown-model'], 'http://localhost/v1');
		assert.deepStrictEqual(models.map(model => model.id), ['gemini-3-flash', 'claude-opus-5']);
		const opus = models.find(model => model.id === 'claude-opus-5')!;
		const gemini = models.find(model => model.id === 'gemini-3-flash')!;
		assert.deepStrictEqual([opus.contextWindow, opus.maxInputTokens, opus.maxOutputTokens], [1000000, undefined, 128000]);
		assert.deepStrictEqual([gemini.contextWindow, gemini.maxInputTokens, gemini.maxOutputTokens], [undefined, 1048576, 65536]);
		assert.ok(!Object.hasOwn(opus, 'maxInputTokens') && !Object.hasOwn(gemini, 'contextWindow'));
		assert.deepStrictEqual(unmatched, ['unknown-model']);
	});

	test('enables adaptive thinking only for Claude models that support it', () => {
		const { models } = toCustomEndpointModels(['claude-opus-5-5', 'claude-opus-4-5', 'claude-sonnet-4-5', 'gpt-6-sol'], 'http://localhost/v1');
		const byId = new Map(models.map(model => [model.id, model]));
		assert.strictEqual(byId.get('claude-opus-5-5')?.adaptiveThinking, true);
		assert.strictEqual(byId.get('claude-opus-5-5')?.thinking, true);
		for (const id of ['claude-opus-4-5', 'claude-sonnet-4-5', 'gpt-6-sol']) {
			assert.ok(!Object.hasOwn(byId.get(id)!, 'adaptiveThinking'), id);
		}
		// Without adaptive thinking the provider sends no thinking config or effort.
		assert.strictEqual(byId.get('claude-opus-4-5')?.thinking, false);
		assert.ok(!Object.hasOwn(byId.get('claude-opus-4-5')!, 'supportsReasoningEffort'));
	});

	test('points each model at the full endpoint path of its API', () => {
		const { models } = toCustomEndpointModels(['gpt-6-sol', 'claude-opus-5-5', 'glm-5.1'], 'http://localhost:4242/v1');
		assert.deepStrictEqual(Object.fromEntries(models.map(model => [model.id, model.url])), {
			'gpt-6-sol': 'http://localhost:4242/v1/responses',
			'claude-opus-5-5': 'http://localhost:4242/v1/messages',
			'glm-5.1': 'http://localhost:4242/v1/chat/completions',
		});
	});
});
