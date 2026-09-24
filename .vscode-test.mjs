import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Test against the minimum supported version (engines.vscode).
	version: '1.134.0',
});
