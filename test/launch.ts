import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

void runTests({
  version: '1.90.2',
  extensionDevelopmentPath: path.resolve(__dirname, '../..'),
  extensionTestsPath: path.join(__dirname, 'integration.js'),
  launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes'],
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
