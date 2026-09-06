// test/unit/screencast-viewer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openViewerCommand } from '../../script/lib/screencast.mjs';

test('openViewerCommand：三平台命令分派', () => {
  assert.deepEqual(openViewerCommand('darwin', 'http://x'),
    { cmd: 'open', args: ['http://x'] });
  assert.deepEqual(openViewerCommand('win32', 'http://x'),
    { cmd: 'cmd', args: ['/c', 'start', '', 'http://x'] });
  assert.deepEqual(openViewerCommand('linux', 'http://x'),
    { cmd: 'xdg-open', args: ['http://x'] });
});
