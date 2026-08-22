import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  imageStemFromUrl,
  extFromUrl,
  extFromContentType,
  NameAllocator,
} from '../../script/lib/download_images.mjs';

// ── imageStemFromUrl：URL → 干净文件名词干 ──

test('imageStemFromUrl: 常规路径取 basename 去扩展名', () => {
  assert.equal(imageStemFromUrl('https://example.com/a/cover.png'), 'cover');
  assert.equal(imageStemFromUrl('https://example.com/hero.jpeg'), 'hero');
});

test('imageStemFromUrl: 查询串与哈希不参与', () => {
  assert.equal(imageStemFromUrl('https://example.com/a/cover.png?w=200&h=100'), 'cover');
  assert.equal(imageStemFromUrl('https://example.com/a/cover.png#frag'), 'cover');
});

test('imageStemFromUrl: 百分号编码先解码再取名', () => {
  assert.equal(imageStemFromUrl('https://example.com/%E5%9B%BE%E7%89%87.png'), '图片');
});

test('imageStemFromUrl: 解码引入的路径分隔符与特殊字符被清洗', () => {
  // %2F 解码为 "/"，不得让名字穿越目录
  assert.equal(imageStemFromUrl('https://example.com/a%2Fb.png'), 'a_b');
  assert.equal(imageStemFromUrl('https://example.com/we ird*.png'), 'we_ird_');
});

test('imageStemFromUrl: 未知扩展名整体作词干（不截断信息）', () => {
  assert.equal(imageStemFromUrl('https://example.com/photo.v2'), 'photo.v2');
});

test('imageStemFromUrl: 空路径 / 目录结尾 / 点路径回退 image', () => {
  assert.equal(imageStemFromUrl('https://example.com/'), 'image');
  assert.equal(imageStemFromUrl('https://example.com/a/'), 'image');
  assert.equal(imageStemFromUrl('https://example.com/..'), 'image');
  assert.equal(imageStemFromUrl('https://example.com/.hidden.png'), 'hidden');
});

// ── 扩展名解析 ──

test('extFromUrl: 已知图片扩展名带点返回，未知/缺失返回 null', () => {
  assert.equal(extFromUrl('https://example.com/a.png'), '.png');
  assert.equal(extFromUrl('https://example.com/a.JPG'), '.jpg');
  assert.equal(extFromUrl('https://example.com/a.jpeg'), '.jpg');
  assert.equal(extFromUrl('https://example.com/a.webp?x=1'), '.webp');
  assert.equal(extFromUrl('https://example.com/a'), null);
  assert.equal(extFromUrl('https://example.com/a.html'), null);
});

test('extFromContentType: mime 映射，未知返回 null', () => {
  assert.equal(extFromContentType('image/png'), '.png');
  assert.equal(extFromContentType('image/jpeg; charset=binary'), '.jpg');
  assert.equal(extFromContentType('image/svg+xml'), '.svg');
  assert.equal(extFromContentType('application/json'), null);
  assert.equal(extFromContentType(undefined), null);
});

// ── NameAllocator：优先原名，冲突带编号 ──

test('NameAllocator: 首个用原名，同名冲突带 -n 编号', () => {
  const a = new NameAllocator();
  assert.equal(a.take('cover', '.png'), 'cover.png');
  assert.equal(a.take('cover', '.png'), 'cover-1.png');
  assert.equal(a.take('cover', '.png'), 'cover-2.png');
});

test('NameAllocator: 不同扩展名不冲突', () => {
  const a = new NameAllocator();
  assert.equal(a.take('cover', '.png'), 'cover.png');
  assert.equal(a.take('cover', '.jpg'), 'cover.jpg');
});

test('NameAllocator: 词干不同互不影响', () => {
  const a = new NameAllocator();
  assert.equal(a.take('cover', '.png'), 'cover.png');
  assert.equal(a.take('hero', '.png'), 'hero.png');
  assert.equal(a.take('cover', '.png'), 'cover-1.png');
  assert.equal(a.take('hero', '.png'), 'hero-1.png');
});

test('NameAllocator: 原名本身带 -1 时编号继续追加不覆盖', () => {
  const a = new NameAllocator();
  assert.equal(a.take('cover-1', '.png'), 'cover-1.png');
  assert.equal(a.take('cover-1', '.png'), 'cover-1-1.png');
});
