import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureServer } from '../helpers/fixture-server.mjs';

test('夹具服务器可启动并服务 404/200', async () => {
  const fx = await startFixtureServer();
  const res = await fetch(`${fx.url}/no-such-file.html`);
  assert.equal(res.status, 404);
  await fx.close();
});
