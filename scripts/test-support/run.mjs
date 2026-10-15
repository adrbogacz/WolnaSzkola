// `npm test`: runs each scripts/test-*.ts with Node's type stripping (Node >= 22.6), no tsx download.
import { spawnSync } from 'node:child_process';

const suites = ['test-grades', 'test-messages', 'test-http', 'test-receivers', 'test-messaging-client'];
for (const suite of suites) {
  console.log(`\n# ${suite}`);
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--import', './scripts/test-support/register.mjs', `scripts/${suite}.ts`],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
