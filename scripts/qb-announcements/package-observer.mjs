import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const modules = ['lib/regular-publication/espn.mjs', ...[
  'lambda.mjs', 'nflverse.mjs', 'observe.mjs', 'sources.mjs',
].map(name => `scripts/qb-announcements/${name}`)];

// Build a standalone project from an explicit file list. No application
// bundle, database library, credentials or local environment files are copied.
export async function packageObserver(destination) {
  const target = resolve(destination);
  await mkdir(target);
  for (const file of modules) {
    const output = join(target, file);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(new URL(file, root), output);
  }
  await writeFile(join(target, 'index.mjs'), `export { handler } from './scripts/qb-announcements/lambda.mjs';\n`);
  await writeFile(join(target, 'package.json'), JSON.stringify({
    name: 'pool-nfl-qb-observer', private: true, type: 'module', engines: { node: '24.x' },
  }, null, 2) + '\n');
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/qb-announcements/package-observer.mjs <new-directory>');
    process.exitCode = 1;
  } else {
    packageObserver(process.argv[2]).then(console.log).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
