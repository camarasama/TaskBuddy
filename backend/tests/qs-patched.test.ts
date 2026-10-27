/**
 * express parses every request's query string with qs (the default "extended" parser). qs <= 6.15.3
 * had two DoS advisories (GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx), accepted as DEP-12 until
 * express 4.22.3 moved to qs ~6.16.0. This pins the copy EXPRESS actually loads, so a dependency
 * change that drags an old qs back in fails here, not only in the audit job.
 */

import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';

function versionOf(pkg: string, from: string): string {
  const entry = require.resolve(pkg, { paths: [from] });
  let dir = path.dirname(entry);
  while (!fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
}

function atLeast(v: string, min: [number, number, number]): boolean {
  const [a, b, c] = v.split('.').map((n) => parseInt(n, 10));
  return a !== min[0] ? a > min[0] : b !== min[1] ? b > min[1] : c >= min[2];
}

it('express and body-parser load qs >= 6.16.0', () => {
  const expressDir = path.dirname(require.resolve('express/package.json'));
  const bodyParserDir = path.dirname(require.resolve('body-parser/package.json', { paths: [expressDir] }));
  expect(atLeast(versionOf('qs', expressDir), [6, 16, 0])).toBe(true);
  expect(atLeast(versionOf('qs', bodyParserDir), [6, 16, 0])).toBe(true);
});

it('still parses nested and array query strings the way the routes expect', async () => {
  // Express 5 defaults to the "simple" parser, which would return { 'status[]': [...] }. The app
  // sets 'extended' (src/index.ts); this mirrors that setting.
  const app = express();
  app.set('query parser', 'extended');
  app.get('/q', (req, res) => res.json(req.query));
  const res = await request(app).get('/q?status[]=pending&status[]=approved&page=2&filter[child]=c1');
  expect(res.body).toEqual({ status: ['pending', 'approved'], page: '2', filter: { child: 'c1' } });
});

it('the real app keeps the extended (qs) query parser under Express 5', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8');
  expect(src).toContain("app.set('query parser', 'extended');");
});
