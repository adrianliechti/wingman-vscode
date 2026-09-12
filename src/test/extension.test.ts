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

	test('reserves the output budget within vendor context windows and reports unknown ids', () => {
		const { models, unmatched } = toCustomEndpointModels(['claude-opus-5', 'gemini-3-flash', 'unknown-model'], 'http://localhost/v1');
		assert.deepStrictEqual(models.map(model => model.id), ['gemini-3-flash', 'claude-opus-5']);
		assert.strictEqual(models.find(model => model.id === 'claude-opus-5')?.maxInputTokens, 1000000 - 128000);
		assert.strictEqual(models.find(model => model.id === 'gemini-3-flash')?.maxInputTokens, 1048576);
		assert.deepStrictEqual(unmatched, ['unknown-model']);
	});
});
