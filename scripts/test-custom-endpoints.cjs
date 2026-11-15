// Exercise the installed VS Code/Copilot provider in an isolated profile.
// Usage: VSCODE_EXECUTABLE_PATH=/path/to/Code npm run test:custom-endpoints
const { runTests } = require('@vscode/test-electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wingman-endpoint-test-'));
  const user = path.join(root, 'user');
  await fs.mkdir(path.join(user, 'User'), { recursive: true });
  await fs.writeFile(path.join(user, 'User/settings.json'), JSON.stringify({
    'wingman.agentHost.autoStart': false,
    'telemetry.telemetryLevel': 'off',
    'security.workspace.trust.enabled': false,
    'workbench.startupEditor': 'none',
    'chat.agentHost.byokModels.enabled': true,
  }));
  console.log(`Isolated test profile: ${root}`);
  await runTests({
    ...(process.env.VSCODE_EXECUTABLE_PATH ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH } : { version: 'stable' }),
    extensionDevelopmentPath: path.resolve(__dirname, '..'),
    extensionTestsPath: path.join(__dirname, 'custom-endpoints-suite.cjs'),
    launchArgs: ['--user-data-dir', user, '--extensions-dir', path.join(root, 'extensions'), '--skip-welcome', '--skip-release-notes', '--disable-updates'],
  });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
