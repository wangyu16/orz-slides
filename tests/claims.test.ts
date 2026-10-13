/**
 * The claims registry is live (the pattern of orz-markdown's
 * tests/claims.test.ts): every claim in notes/CLAIMS.md must be bound to at
 * least one test (its id in a test title, e.g. `[A.1]`), and no test may cite
 * a claim that is not registered. Unverified is red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const registry = readFileSync('notes/CLAIMS.md', 'utf8');
const registered = new Set([...registry.matchAll(/^\| ([A-Z]\.\d+) \|/gm)].map((m) => m[1]));

const cited = new Map<string, string[]>();
for (const file of (readdirSync('tests', { recursive: true }) as string[]).filter((f) => /\.test\.ts$/.test(f) && f !== 'claims.test.ts')) {
  const src = readFileSync(`tests/${file}`, 'utf8');
  for (const m of src.matchAll(/\[([A-Z]\.\d+)\]/g)) {
    cited.set(m[1], [...(cited.get(m[1]) ?? []), file]);
  }
}

describe('claims registry', () => {
  it('has claims', () => {
    expect(registered.size).toBeGreaterThan(0);
  });

  it('binds every registered claim to at least one test', () => {
    const unverified = [...registered].filter((id) => !cited.has(id));
    expect(unverified).toEqual([]);
  });

  it('cites only registered claims', () => {
    const unknown = [...cited.keys()].filter((id) => !registered.has(id));
    expect(unknown).toEqual([]);
  });
});
