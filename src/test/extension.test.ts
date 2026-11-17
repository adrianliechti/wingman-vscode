import * as assert from 'assert';

import { selectUtilityModels, toCustomEndpointModels } from '../models';

suite('Utility model selection', () => {
	test('uses Wingman Bearer authentication for every protocol without embedding a credential', () => {
		const { models } = toCustomEndpointModels(['gpt-6-sol', 'claude-sonnet-5-5', 'glm-5.3'], 'http://localhost:4242/v1');
		assert.strictEqual(models.length, 3);
		for (const model of models) {
			assert.deepStrictEqual(model.requestHeaders, { Authorization: 'Bearer ${apiKey}' });
		}
	});
	test('prefers medium and small models in catalog order, independently of backend order', () => {
		assert.deepStrictEqual(selectUtilityModels([
			'claude-haiku-5-5', 'gpt-6-astra', 'claude-sonnet-5-5', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra',
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
		assert.deepStrictEqual(selectUtilityModels(['glm-5.3', 'qwen/qwen3.8-flash']), {
			utilityModel: 'glm-5.3',
			utilitySmallModel: 'qwen/qwen3.8-flash',
		});
	});

	test('shares a medium model when no small model is available', () => {
		assert.deepStrictEqual(selectUtilityModels(['gpt-6-astra', 'claude-sonnet-5-5']), {
			utilityModel: 'claude-sonnet-5-5',
			utilitySmallModel: 'claude-sonnet-5-5',
		});
	});

	test('falls back to a small model before a large model for general utilities', () => {
		assert.deepStrictEqual(selectUtilityModels(['gpt-6-astra', 'claude-haiku-5-5']), {
			utilityModel: 'claude-haiku-5-5',
			utilitySmallModel: 'claude-haiku-5-5',
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
		const { models, unmatched } = toCustomEndpointModels(['claude-opus-5-5', 'gemini-4-carbon', 'unknown-model'], 'http://localhost/v1');
		assert.deepStrictEqual(models.map(model => model.id), ['gemini-4-carbon', 'claude-opus-5-5']);
		const opus = models.find(model => model.id === 'claude-opus-5-5')!;
		const gemini = models.find(model => model.id === 'gemini-4-carbon')!;
		assert.deepStrictEqual([opus.contextWindow, opus.maxOutputTokens], [1000000, 128000]);
		assert.deepStrictEqual([gemini.contextWindow, gemini.maxOutputTokens], [1048576, 65536]);
		assert.ok(models.every(model => !Object.hasOwn(model, 'maxInputTokens')));
		assert.deepStrictEqual(unmatched, ['unknown-model']);
	});

	test('discovers both GPT 6.2 models with Responses API capabilities', () => {
		const ids = ['gpt-6.2-astra', 'gpt-6.2-sol'];
		const { models, unmatched } = toCustomEndpointModels(ids, 'http://localhost:4242/v1');
		assert.deepStrictEqual(unmatched, []);
		assert.deepStrictEqual(models.map(model => model.id), ids);
		for (const model of models) {
			assert.strictEqual(model.apiType, 'responses');
			assert.strictEqual(model.url, 'http://localhost:4242/v1/responses');
			assert.deepStrictEqual([model.contextWindow, model.maxOutputTokens], [1050000, 128000]);
			assert.strictEqual(model.vision, true);
			assert.strictEqual(model.toolCalling, true);
			assert.strictEqual(model.thinking, true);
			assert.deepStrictEqual(model.supportsReasoningEffort, ['low', 'medium', 'high', 'xhigh', 'max']);
		}
	});

	test('reserves synchronous output inside shared Gemini 4 windows', () => {
		const { models } = toCustomEndpointModels(['gemini-4-carbon', 'gemini-4-argon', 'gemini-4-hydrogen'], 'http://localhost/v1');
		assert.strictEqual(models.length, 3);
		for (const model of models) {
			assert.deepStrictEqual([model.contextWindow, model.maxOutputTokens], [1048576, 65536]);
			assert.ok(!Object.hasOwn(model, 'maxInputTokens'));
		}
	});

	test('advertises adaptive thinking for current Claude models', () => {
		const claudeIds = ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
		const { models } = toCustomEndpointModels([...claudeIds, 'gpt-6-sol'], 'http://localhost/v1');
		const byId = new Map(models.map(model => [model.id, model]));
		for (const id of claudeIds) {
			assert.strictEqual(byId.get(id)?.adaptiveThinking, true, id);
			assert.strictEqual(byId.get(id)?.thinking, true, id);
			assert.deepStrictEqual(byId.get(id)?.supportsReasoningEffort, ['low', 'medium', 'high', 'xhigh', 'max'], id);
		}
		assert.ok(!Object.hasOwn(byId.get('gpt-6-sol')!, 'adaptiveThinking'));
	});

	test('discovers Haiku 5.5 with native efforts', () => {
		const { models, unmatched } = toCustomEndpointModels(['claude-haiku-5-5'], 'http://localhost:4242/v1');
		assert.deepStrictEqual(unmatched, []);
		assert.strictEqual(models.length, 1);
		const haiku = models[0];
		assert.strictEqual(haiku.url, 'http://localhost:4242/v1/messages');
		assert.deepStrictEqual([haiku.contextWindow, haiku.maxOutputTokens], [1000000, 128000]);
		assert.strictEqual(haiku.adaptiveThinking, true);
		assert.strictEqual(haiku.vision, true);
		assert.strictEqual(haiku.toolCalling, true);
		assert.deepStrictEqual(haiku.supportsReasoningEffort, ['low', 'medium', 'high', 'xhigh', 'max']);
	});

	test('points each model at the full endpoint path of its API', () => {
		const { models } = toCustomEndpointModels(['gpt-6-sol', 'claude-opus-5-5', 'glm-5.3'], 'http://localhost:4242/v1');
		assert.deepStrictEqual(Object.fromEntries(models.map(model => [model.id, model.url])), {
			'gpt-6-sol': 'http://localhost:4242/v1/responses',
			'claude-opus-5-5': 'http://localhost:4242/v1/messages',
			'glm-5.3': 'http://localhost:4242/v1/chat/completions',
		});
	});
});
