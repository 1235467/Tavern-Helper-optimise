// specifiers.test.ts — lexer/rewrite fixtures for the module cache.
import { describe, expect, it } from 'vitest';
import {
  extractCdnImportUrls,
  resolveSpecifier,
  rewriteModule,
  scanModuleSpecifiers,
} from '@/core/module_cache/specifiers';

const CDN = 'https://testingcf.jsdelivr.net/gh/user/repo@1.0.0/dist/index.js';

describe('scanModuleSpecifiers', () => {
  const kindsOf = (code: string) => scanModuleSpecifiers(code).map(s => ({ spec: s.spec, kind: s.kind }));

  it('finds all import/export/dynamic forms', () => {
    const code = `
      import{a}from'https://cdn.example/a.js';
      import 'https://cdn.example/b.js';
      import * as c from "https://cdn.example/c.js";
      import d, {e} from 'https://cdn.example/d.js';
      export {f} from 'https://cdn.example/f.js';
      export * as g from 'https://cdn.example/g.js';
      const h = await import('https://cdn.example/h.js');
      import('https://cdn.example/i.js');
      await import ('https://cdn.example/j.js');
    `;
    const specs = kindsOf(code);
    const urls = specs.map(s => s.spec);
    for (const u of ['a','b','c','d','f','g','h','i','j']) {
      expect(urls, `missing ${u}`).toContain(`https://cdn.example/${u}.js`);
    }
    expect(specs.find(s => s.spec?.includes('h.js'))?.kind).toBe('dynamic');
    expect(specs.find(s => s.spec?.includes('f.js'))?.kind).toBe('export');
  });

  it('skips strings, comments, templates', () => {
    const code = `
      // import 'https://cdn.example/nope1.js'
      /* import "https://cdn.example/nope2.js" */
      const s = 'import "https://cdn.example/nope3.js"';
      const t = "text import 'https://cdn.example/nope4.js' end";
      const tpl = \`import 'https://cdn.example/nope5.js' \${x} tail\`;
      const real = import 'https://cdn.example/real.js';
    `;
    const urls = scanModuleSpecifiers(code).map(s => s.spec);
    expect(urls).toEqual(['https://cdn.example/real.js']);
  });

  it('handles minified bundles and import.meta.url', () => {
    const code = `import{a as x}from'https://cdn.example/a.js';const y=new URL('./asset.png',import.meta.url);`;
    const specs = scanModuleSpecifiers(code);
    expect(specs.find(s => s.kind === 'static')?.spec).toBe('https://cdn.example/a.js');
    expect(specs.find(s => s.kind === 'meta')).toBeTruthy();
  });

  it('does not capture non-literal dynamic imports', () => {
    const code = `const m = await import(expr + '/x.js'); import ( 'https://cdn.example/ok.js' );`;
    const urls = scanModuleSpecifiers(code).map(s => s.spec).filter(Boolean);
    expect(urls).toEqual(['https://cdn.example/ok.js']);
  });
});

describe('resolveSpecifier', () => {
  it('passes full urls through', () => {
    expect(resolveSpecifier('https://cdn.example/a.js', CDN)).toBe('https://cdn.example/a.js');
  });
  it('resolves root-relative against parent', () => {
    expect(resolveSpecifier('/npm/zod@3/+esm', CDN)).toBe('https://testingcf.jsdelivr.net/npm/zod@3/+esm');
  });
  it('resolves ./ and ../ against parent file path', () => {
    expect(resolveSpecifier('./rel.js', CDN)).toBe('https://testingcf.jsdelivr.net/gh/user/repo@1.0.0/dist/rel.js');
    expect(resolveSpecifier('../up.js', CDN)).toBe('https://testingcf.jsdelivr.net/gh/user/repo@1.0.0/up.js');
  });
  it('skips bare/data/blob specifiers', () => {
    expect(resolveSpecifier('zod', CDN)).toBeNull();
    expect(resolveSpecifier('data:text/plain,x', CDN)).toBeNull();
    expect(resolveSpecifier('blob:https://o/id', CDN)).toBeNull();
  });
});

describe('rewriteModule', () => {
  it('rewrites deps to canonical absolute URLs', () => {
    const code = `import{a}from'https://cdn.example/a.js';import{b}from'/npm/b@2/+esm';import{c}from'./rel.js';`;
    const { text, deps } = rewriteModule(code, 'https://testingcf.jsdelivr.net/gh/user/repo@1.0.0/dist/index.js');
    expect(text).toContain(`from'https://cdn.example/a.js'`);
    expect(text).toContain(`from'https://testingcf.jsdelivr.net/npm/b@2/+esm'`);
    expect(text).toContain(`from'https://testingcf.jsdelivr.net/gh/user/repo@1.0.0/dist/rel.js'`);
    expect(deps).toEqual([
      'https://cdn.example/a.js',
      'https://testingcf.jsdelivr.net/npm/b@2/+esm',
      'https://testingcf.jsdelivr.net/gh/user/repo@1.0.0/dist/rel.js',
    ]);
  });

  it('leaves bare specifiers untouched and does not touch strings', () => {
    const code = `import z from 'zod'; const s = "import 'https://cdn.example/str.js'";`;
    const { text, deps } = rewriteModule(code, CDN);
    expect(text).toBe(code);
    expect(deps).toEqual([]);
  });

  it('rewrites import.meta.url to the parent URL literal', () => {
    const code = `const u = new URL('./a.png', import.meta.url);`;
    const { text } = rewriteModule(code, CDN);
    expect(text).toBe(`const u = new URL('./a.png', ${JSON.stringify(CDN)});`);
  });
});

describe('extractCdnImportUrls', () => {
  it('finds top-level CDN imports in script content', () => {
    const content = `
      import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';
      import {x} from 'https://cdn.example/mod.js';
      const y = await import('https://cdn.example/dyn.js');
      import './local.js';
      import 'bare-package';
    `;
    expect(extractCdnImportUrls(content)).toEqual([
      'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js',
      'https://cdn.example/mod.js',
      'https://cdn.example/dyn.js',
    ]);
  });
});
