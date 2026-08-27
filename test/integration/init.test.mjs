// test/integration/init.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { runScript } from '../helpers/run-script.mjs';

const HAS_PNPM = spawnSync('pnpm', ['--version']).status === 0;

const URL = 'https://example.com/a?b=1';
// 与 lib/env.mjs urlToDirName 一致：剥 http(s):// 前缀，非 [A-Za-z0-9.-] → _
const URL_NAME = 'example.com_a_b_1';
let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-init-'));
});

after(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('init.sh: --url 输出 ok JSON（核心参数 + 环境信息）并创建工作目录', { timeout: 300000 }, async () => {
  const r = await runScript('bash', [path.resolve('script/init.sh'), '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 280000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'stdout 恰一行');
  const json = JSON.parse(lines[0]);
  assert.equal(json.status, 'ok');
  // 核心参数
  assert.equal(json['skill-root'], path.resolve('.'));
  assert.equal(json['url-name'], URL_NAME, 'url-name 须与步骤 1 的目录派生逻辑一致');
  assert.equal(json['url-working-path'], path.join(tmpRoot, URL_NAME));
  assert.ok(fs.existsSync(json['url-working-path']), '步骤 0 应创建工作目录');
  // 环境信息
  assert.ok(json.node);
  assert.ok(['pnpm', 'yarn', 'npm'].includes(json.pm));
  assert.equal(json.chromium, true);
});

test('init.sh: 幂等——二次运行依旧 ok', { timeout: 300000 }, async () => {
  const r = await runScript('bash', [path.resolve('script/init.sh'), '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 280000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const json = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]);
  assert.equal(json.status, 'ok');
});

test('init.sh: node_modules 由异版 pnpm 生成时非交互自愈（无 TTY 不因清空确认中止）', { timeout: 300000, skip: !HAS_PNPM }, async () => {
  // 现场：node_modules/.modules.yaml 声明由另一 pnpm 大版本安装（且缺 .pnpm 虚拟店）。
  // pnpm 检测到需清空重建时会寻求 TTY 确认；agent 调用 init.sh 无 TTY，
  // 未开 CI 模式时直接 ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY 中止。
  const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-init-purge-'));
  let workRoot;
  try {
    fs.cpSync('script', path.join(projRoot, 'script'), { recursive: true });
    fs.copyFileSync('package.json', path.join(projRoot, 'package.json'));
    fs.copyFileSync('pnpm-lock.yaml', path.join(projRoot, 'pnpm-lock.yaml'));
    fs.mkdirSync(path.join(projRoot, 'node_modules'));
    const realYaml = fs.readFileSync('node_modules/.modules.yaml', 'utf8');
    const tampered = realYaml.replace(
      /(['"]?)packageManager\1(\s*:\s*)(['"]?)pnpm@[\d.]+\3/,
      '$1packageManager$2$3pnpm@11.15.1$3',
    );
    fs.writeFileSync(path.join(projRoot, 'node_modules/.modules.yaml'), tampered);
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-init-work-'));
    const r = await runScript('bash', [path.join(projRoot, 'script/init.sh'), '--url', URL], {
      env: { U2M_WORKING_ROOT: workRoot },
      timeoutMs: 280000,
    });
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const json = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]);
    assert.equal(json.status, 'ok');
  } finally {
    fs.rmSync(projRoot, { recursive: true, force: true });
    if (workRoot) fs.rmSync(workRoot, { recursive: true, force: true });
  }
});

test('init.sh: 缺 --url 时输出 usage_error 退出 2', async () => {
  const r = await runScript('bash', [path.resolve('script/init.sh')]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

// ── Linux 字体自检（最小化镜像缺 fontconfig 配置/字体时 chromium 渲染即 FATAL 崩溃）──
// init.sh 仅在 uname=Linux 时检查；测试用 PATH 垫片（uname/fc-list/sudo/apt-get）
// + U2M_FONTCONFIG_CONF / U2M_FONT_DIR 覆盖探测路径，在任意宿主上密封模拟 Linux。
function makeFontShims(binDir, apt, { zh = false, fcList = true } = {}) {
  fs.mkdirSync(binDir, { recursive: true });
  const aptLog = path.join(binDir, 'apt-get.log');
  let aptBody = `echo "$@" >> '${aptLog}'\n`;
  if (apt === 'fix') {
    aptBody += `mkdir -p "$(dirname "$U2M_FONTCONFIG_CONF")"; : > "$U2M_FONTCONFIG_CONF"\n`
      + `mkdir -p "$U2M_FONT_DIR"; : > "$U2M_FONT_DIR/Dummy.ttf"\nexit 0`;
  } else if (apt === 'fail') {
    aptBody += 'exit 1';
  } else {
    aptBody += 'exit 0'; // 健康场景不应被调用；调了也只记账
  }
  const shims = { uname: 'echo Linux', sudo: 'exec "$@"', 'apt-get': aptBody };
  // fc-list：zh=true 模拟中西文齐全；zh=false 静默（无任何可列字体）
  if (fcList) {
    shims['fc-list'] = zh
      ? `if [ "$1" = ':lang=zh' ]; then echo /usr/share/fonts/NotoSansCJK-Regular.ttc: NotoSansCJK; exit 0; fi\n`
        + `echo /usr/share/fonts/LiberationSans-Regular.ttf: LiberationSans; exit 0`
      : 'exit 0';
  }
  for (const [name, body] of Object.entries(shims)) {
    const p = path.join(binDir, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(p, 0o755);
  }
  return { aptLog };
}

function fontEnv(binDir, projState, workRoot) {
  return {
    U2M_WORKING_ROOT: workRoot,
    PATH: `${binDir}:${process.env.PATH}`,
    U2M_FONTCONFIG_CONF: path.join(projState, 'fonts.conf'),
    U2M_FONT_DIR: path.join(projState, 'fonts'),
  };
}

test('init.sh(Linux): fontconfig 配置/字体缺失时自动修复后 ok', { timeout: 300000 }, async () => {
  const projState = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-font-fix-'));
  let workRoot;
  try {
    const { aptLog } = makeFontShims(path.join(projState, 'bin'), 'fix');
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-init-work-'));
    const r = await runScript('bash', [path.resolve('script/init.sh'), '--url', URL], {
      env: fontEnv(path.join(projState, 'bin'), projState, workRoot),
      timeoutMs: 280000,
    });
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const json = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]);
    assert.equal(json.status, 'ok');
    assert.ok(fs.existsSync(path.join(projState, 'fonts.conf')), '修复后应生成 fontconfig 配置');
    assert.ok(
      fs.readFileSync(aptLog, 'utf8').includes('fontconfig'),
      '应经包管理器安装 fontconfig',
    );
    assert.match(fs.readFileSync(aptLog, 'utf8'), /noto-cjk|cjk/i, '应补装 CJK 字体');
  } finally {
    fs.rmSync(projState, { recursive: true, force: true });
    if (workRoot) fs.rmSync(workRoot, { recursive: true, force: true });
  }
});

test('init.sh(Linux): 中西文字体齐全时不重复安装', { timeout: 300000 }, async () => {
  const projState = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-font-ok-'));
  let workRoot;
  try {
    const binDir = path.join(projState, 'bin');
    const { aptLog } = makeFontShims(binDir, 'observe', { zh: true });
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-init-work-'));
    const r = await runScript('bash', [path.resolve('script/init.sh'), '--url', URL], {
      env: fontEnv(binDir, projState, workRoot),
      timeoutMs: 280000,
    });
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    assert.equal(JSON.parse(r.stdout.split('\n').filter(Boolean)[0]).status, 'ok');
    assert.ok(!fs.existsSync(aptLog), '健康时不应调用包管理器');
  } finally {
    fs.rmSync(projState, { recursive: true, force: true });
    if (workRoot) fs.rmSync(workRoot, { recursive: true, force: true });
  }
});

test('init.sh(Linux): 无 fc-list 时按文件名判中西文齐全、不重装', { timeout: 300000 }, async () => {
  const projState = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-font-nofc-'));
  let workRoot;
  try {
    const binDir = path.join(projState, 'bin');
    const { aptLog } = makeFontShims(binDir, 'observe', { fcList: false });
    // 文件探测路径上的中西文健康态：配置 + 西文 ttf + CJK 命名字体
    fs.writeFileSync(path.join(projState, 'fonts.conf'), '');
    fs.mkdirSync(path.join(projState, 'fonts'));
    fs.writeFileSync(path.join(projState, 'fonts', 'LiberationSans-Regular.ttf'), '');
    fs.writeFileSync(path.join(projState, 'fonts', 'NotoSansCJKsc-Regular.otf'), '');
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-init-work-'));
    const r = await runScript('bash', [path.resolve('script/init.sh'), '--url', URL], {
      env: fontEnv(binDir, projState, workRoot),
      timeoutMs: 280000,
    });
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    assert.equal(JSON.parse(r.stdout.split('\n').filter(Boolean)[0]).status, 'ok');
    assert.ok(!fs.existsSync(aptLog), '文件名判健康时不应调用包管理器');
  } finally {
    fs.rmSync(projState, { recursive: true, force: true });
    if (workRoot) fs.rmSync(workRoot, { recursive: true, force: true });
  }
});

test('init.sh(Linux): 西文健康但缺 CJK 时补装；补装失败仅警告不阻断', { timeout: 300000 }, async () => {
  const projState = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-font-cjk-'));
  let workRoot;
  try {
    const binDir = path.join(projState, 'bin');
    const { aptLog } = makeFontShims(binDir, 'fail'); // fc-list 静默：无任何可列字体
    // 崩溃门健康：配置 + 西文字体文件存在；但无 CJK
    fs.writeFileSync(path.join(projState, 'fonts.conf'), '');
    fs.mkdirSync(path.join(projState, 'fonts'));
    fs.writeFileSync(path.join(projState, 'fonts', 'Dummy.ttf'), '');
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-init-work-'));
    const r = await runScript('bash', [path.resolve('script/init.sh'), '--url', URL], {
      env: fontEnv(binDir, projState, workRoot),
      timeoutMs: 280000,
    });
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    assert.equal(JSON.parse(r.stdout.split('\n').filter(Boolean)[0]).status, 'ok');
    assert.match(fs.readFileSync(aptLog, 'utf8'), /noto-cjk/, '应尝试补装 CJK 字体');
    assert.match(r.stderr, /豆腐/, 'CJK 缺失应警告截图豆腐块');
  } finally {
    fs.rmSync(projState, { recursive: true, force: true });
    if (workRoot) fs.rmSync(workRoot, { recursive: true, force: true });
  }
});

test('init.sh(Linux): 修复失败时输出 error 并退出 1', { timeout: 300000 }, async () => {
  const projState = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-font-fail-'));
  let workRoot;
  try {
    makeFontShims(path.join(projState, 'bin'), 'fail');
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-init-work-'));
    const r = await runScript('bash', [path.resolve('script/init.sh'), '--url', URL], {
      env: fontEnv(path.join(projState, 'bin'), projState, workRoot),
      timeoutMs: 280000,
    });
    assert.equal(r.code, 1);
    const json = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]);
    assert.equal(json.status, 'error');
    assert.match(json.reason, /字体|fontconfig/);
  } finally {
    fs.rmSync(projState, { recursive: true, force: true });
    if (workRoot) fs.rmSync(workRoot, { recursive: true, force: true });
  }
});
