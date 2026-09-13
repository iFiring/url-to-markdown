// test/unit/copy-skill.test.mjs
// 双语导出（copy-skill.mjs）的结构契约：两目录自包含、文件名归一、package.json 改写。
// 副作用仅写 .temp/（已 gitignore）；脚本依赖 cwd 为仓库根——node --test 从仓库根启动，天然满足。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runScript } from '../helpers/run-script.mjs';

const EN_DIR = '.temp/url-to-markdown';
const ZH_DIR = '.temp/url-to-markdown-zh';
const GUIDES = ['analyze_html_guide', 'markdown_skeleton_guide'];

function listFiles(dir, prefix = dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listFiles(`${dir}/${e.name}`) : [`${dir}/${e.name}`.slice(prefix.length + 1)]))
    .sort();
}

test('copy:skill: 导出双语言目录，结构恒等且文件名归一', async () => {
  const r = await runScript(process.execPath, ['copy-skill.mjs']);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);

  // 1) 两目录文件清单恒等
  assert.deepEqual(listFiles(ZH_DIR), listFiles(EN_DIR));

  for (const [dir, skillSrc, readmeSrc, name] of [[EN_DIR, 'SKILL.md', 'README.md', 'url-to-markdown'], [ZH_DIR, 'SKILL.zh-CN.md', 'README.zh-CN.md', 'url-to-markdown-zh']]) {
    // 2) 核心文件在位；SKILL/README 为对应语言源文件的逐字节拷贝
    assert.ok(fs.existsSync(`${dir}/script/snapshot.mjs`), `${dir}/script/snapshot.mjs`);
    assert.equal(fs.readFileSync(`${dir}/SKILL.md`, 'utf8'), fs.readFileSync(skillSrc, 'utf8'));
    assert.match(fs.readFileSync(`${dir}/SKILL.md`, 'utf8'), new RegExp(`^name: ${name}$`, 'm'));
    const readme = fs.readFileSync(`${dir}/README.md`, 'utf8');
    assert.equal(readme, fs.readFileSync(readmeSrc, 'utf8'));
    // README 手册链接目标恒为标准名（导出契约，两版同）
    assert.ok(readme.includes('(SKILL.md)'));
    assert.ok(!readme.includes('(SKILL.zh-CN.md)'));

    // 3) references 恰两份归一名手册、内容取自对应语言源
    assert.deepEqual(fs.readdirSync(`${dir}/references`).sort(), GUIDES.map((g) => `${g}.md`));
    for (const g of GUIDES) {
      const src = dir === ZH_DIR ? `references/${g}.zh-CN.md` : `references/${g}.md`;
      assert.equal(fs.readFileSync(`${dir}/references/${g}.md`, 'utf8'), fs.readFileSync(src, 'utf8'));
    }

    // 4) 导出 package.json：name 三方一致、scripts 已删、依赖版本钉死（无 ^ 前缀）
    const pkg = JSON.parse(fs.readFileSync(`${dir}/package.json`, 'utf8'));
    assert.equal(pkg.name, name);
    assert.equal(pkg.scripts, undefined);
    for (const v of Object.values(pkg.dependencies)) assert.doesNotMatch(v, /\^/);
  }

  // 5) zh 导出物内无 .zh-CN 文件名（SKILL/references/README 均已归一）
  assert.ok(!listFiles(ZH_DIR).some((f) => f.includes('zh-CN')));
});
