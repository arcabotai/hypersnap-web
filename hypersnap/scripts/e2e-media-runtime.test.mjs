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
  it('keeps casting URL validation strict while accepting only the isolated upload path', async () => {
    const authPath = fileURLToPath(new URL('../src/lib/auth.ts', import.meta.url));
    const source = await fs.readFile(authPath, 'utf8');
    const functionSource = source.match(/function assertHttpsUrl[\s\S]*?\n}\n/)?.[0];
    expect(functionSource).toBeTruthy();
    for (const credentials of ['url.username', '!!url.username']) {
      const variant = functionSource.replace(/(?:!!)?url\.username/, credentials);
      const transformedAuth = replaceTestMediaGuards(variant, authPath, origin);
      const rejectedExpression = transformedAuth.match(/if \((.*?)\) throw new Error\(\);/)?.[1];
      expect(rejectedExpression).toBeTruthy();
      const rejected = new Function('url', `return !!(${rejectedExpression});`);
      expect(rejected(new URL(media))).toBe(false);
      expect(rejected(new URL('https://example.com/photo.png'))).toBe(false);
      for (const unsafe of [
        `${origin}/channel/test`, `${origin}/media/${'a'.repeat(63)}`, `${media}/extra`,
        `http://localhost:5187/media/${'a'.repeat(64)}`, `http://127.0.0.1:5188/media/${'a'.repeat(64)}`,
        `http://attacker.test/media/${'a'.repeat(64)}`, `http://user@127.0.0.1:5187/media/${'a'.repeat(64)}`,
      ]) expect(rejected(new URL(unsafe))).toBe(true);
    }
    const productionExpression = functionSource.match(/if \((.*?)\) throw new Error\(\);/)?.[1];
    expect(new Function('url', `return !!(${productionExpression});`)(new URL(media))).toBe(true);
  });
  it('admits only the isolated hashed image URL through the Photos tab image guard', async () => {
    const apiPath = fileURLToPath(new URL('../src/lib/api.ts', import.meta.url));
    const source = await fs.readFile(apiPath, 'utf8');
    const replaced = replaceTestMediaGuards(replaceTestOrigins(source, origin), apiPath, origin);
    const expression = replaced.match(/return ((?:url\.protocol|\(url\.protocol)[\s\S]*?);/)?.[1];
    expect(expression).toBeTruthy();
    const accepted = new Function('url', `return ${expression};`);
    expect(accepted(new URL(media))).toBe(true);
    for (const rejected of [`${origin}/photo.png`, `${origin}/media/${'a'.repeat(63)}`, `http://localhost:5187/media/${'a'.repeat(64)}`, `http://attacker.test/photo.png`]) expect(accepted(new URL(rejected))).toBe(false);
    const productionExpression = source.match(/return (url\.protocol[\s\S]*?);/)?.[1];
    expect(new Function('url', `return ${productionExpression};`)(new URL(media))).toBe(false);
  });
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
