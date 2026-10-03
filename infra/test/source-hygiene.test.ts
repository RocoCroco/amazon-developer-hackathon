import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = /\.(ts|js|mjs|css|html|md|json)$/;
const SKIP = new Set(['node_modules', 'dist', 'cdk.out', '.git']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : SOURCE.test(name) ? [full] : [];
  });
}

// Shell heredocs and node -e strings have turned "\b" into a real backspace byte (FRICTION_LOG F7, F21),
// which makes a regex silently stop matching. No source file may contain such control characters.
describe('source hygiene', () => {
  it('has no invisible control characters in source files', () => {
    const bad = ['packages', 'scripts', 'infra/lib', 'infra/test', 'docs']
      .flatMap((d) => files(path.join(root, d)))
      .filter((f) => !f.endsWith('ui-assets.generated.ts'))
      // eslint-disable-next-line no-control-regex -- finding control characters is the point of this test
      .filter((f) => /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f));
    expect(bad).toEqual([]);
  });
});
