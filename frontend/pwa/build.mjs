import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Build an exact static allowlist, including Vite chunks/CSS/public icons. No runtime API cache. */
export function pwaBuild() {
  let config;
  return {
    name: 'itertrip-offline', apply: 'build',
    configResolved(c) { config = c; },
    async closeBundle() {
      const dir = path.resolve(config.root, config.build.outDir);
      async function files(at = '') {
        const items = await readdir(path.join(dir, at), { withFileTypes: true });
        return (await Promise.all(items.map(e => e.isDirectory() ? files(path.posix.join(at, e.name)) : path.posix.join(at, e.name)))).flat();
      }
      const names = (await files()).filter(n => n !== 'sw.js' && !n.endsWith('.map')).sort();
      const template = await readFile(fileURLToPath(new URL('./worker.js', import.meta.url)), 'utf8');
      const hash = createHash('sha256').update(config.base).update(template);
      for (const name of names) hash.update(name).update(await readFile(path.join(dir, name)));
      const version = hash.digest('hex').slice(0, 16);
      const base = config.base;
      if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('PWA needs an absolute pathname base');
      const setup = { version, base, files: names.map(n => base + n) };
      await writeFile(path.join(dir, 'sw.js'), template.replace('/* BUILD_CONFIG */', JSON.stringify(setup)));
    },
  };
}
