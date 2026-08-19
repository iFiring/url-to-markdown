import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCodeLang } from '../../script/lib/placeholder.mjs';

test('guessCodeLang: shebang 优先', () => {
  assert.equal(guessCodeLang('#!/usr/bin/env bash\necho hi'), 'bash');
  assert.equal(guessCodeLang('#!/usr/bin/python3\nprint(1)'), 'python');
});

test('guessCodeLang: python 结构', () => {
  assert.equal(guessCodeLang('def hello():\n    print("hi")'), 'python');
});

test('guessCodeLang: javascript 结构', () => {
  assert.equal(guessCodeLang('const x = 1;\nconsole.log(x);'), 'javascript');
  assert.equal(guessCodeLang('function add(a, b) { return a + b; }'), 'javascript');
});

test('guessCodeLang: json', () => {
  assert.equal(guessCodeLang('{"a": 1, "b": [2]}'), 'json');
  assert.equal(guessCodeLang('[1, 2, 3]'), 'json');
});

test('guessCodeLang: html', () => {
  assert.equal(guessCodeLang('<div class="x">hi</div>'), 'html');
});

test('guessCodeLang: 无法判定返回空串', () => {
  assert.equal(guessCodeLang('SELECT * FROM t;'), '');
  assert.equal(guessCodeLang(''), '');
});
