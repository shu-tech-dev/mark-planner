import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main() {
  const root = resolve(__dirname, '../..');
  const workspace = await mkdtemp(join(tmpdir(), 'mark-planner-'));
  await cp(join(root, 'test/integration/fixture'), workspace, { recursive: true });

  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'dist/test/suite.js'),
    launchArgs: [workspace, '--disable-extensions', '--disable-gpu', '--no-sandbox'],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
