import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { replaceTestOrigins, replaceTestMediaGuards, viteTestOriginPlugin } from './e2e-media-runtime.mjs';

const origin = 'http://127.0.0.1:5187';
const media = `${origin}/media/${'a'.repeat(64)}`;
const appPath = fileURLToPath(new URL('../src/App.tsx', import.meta.url));
const app = await fs.readFile(appPath, 'utf8');
const transformed = replaceTestMediaGuards(replaceTestOrigins(app, origin), appPath, origin);

describe('isolated media harness URL transformations', () => {
  it('admits only the configured loopback hashed media path through the actual App URL expression', () => {
    const expression = transformed.match(/return (.*?) \? url\.href : undefined;/)?.[1];
    expect(expression).toBeTruthy();
    // Evaluate only this fixed, first-party boolean URL expression; no app or
    // browser runtime is created and no protocol/authentication code is stubbed.
    const accepted = new Function('url', `return ${expression};`);
    expect(accepted(new URL(media))).toBe(true);
    for (const rejected of [
      `${origin}/not-media/${'a'.repeat(64)}`, `${origin}/media/${'a'.repeat(63)}`,
      `http://localhost:5187/media/${'a'.repeat(64)}`, `http://127.0.0.1:5188/media/${'a'.repeat(64)}`,
      `http://attacker.example/media/${'a'.repeat(64)}`, 'javascript:alert(1)',
    ]) expect(accepted(new URL(rejected))).toBe(false);
    expect(accepted(new URL('https://example.com/image.png'))).toBe(true);
    const original = app.match(/return (.*?) \? url\.href : undefined;/)?.[1];
    expect(new Function('url', `return ${original};`)(new URL(media))).toBe(false);
  });

  it('rewrites the actual hosted-image regex to the exact test origin without wildcard dots or ports', () => {
    const expression = transformed.match(/map\(embed => \/(.*?)\/i\.test\(embed\.url\)/)?.[1];
    expect(expression).toBeTruthy();
    const image = new RegExp(expression, 'i');
    expect(image.test(media)).toBe(true);
    for (const rejected of [
      `http://127x0x0x1:5187/media/${'a'.repeat(64)}`, `http://127.0.0.1:5188/media/${'a'.repeat(64)}`,
      `${media}/extra`, `${origin}/media/${'a'.repeat(63)}`, `https://quorum.arca.computer/media/${'a'.repeat(64)}`,
    ]) expect(image.test(rejected)).toBe(false);
  });

  it('never changes the fixed Hypersnap destination or arbitrary dependencies and refuses non-loopback test origins', async () => {
    const plugin = viteTestOriginPlugin(origin);
    expect(plugin.transform(app, '/external/node_modules/package/src/App.tsx')).toBeUndefined();
    const workerPath = fileURLToPath(new URL('../worker/index.ts', import.meta.url));
    const worker = plugin.transform(await fs.readFile(workerPath, 'utf8'), workerPath);
    expect(worker).toContain("const UPSTREAM = 'https://haatz.quilibrium.com'");
    for (const rejected of ['https://attacker.example', 'http://127.0.0.1.attacker.example:5187', 'http://user@127.0.0.1:5187', `${origin}/unexpected`]) expect(() => viteTestOriginPlugin(rejected)).toThrow('loopback');
  });
});
