// test/unit/copy-skill.test.mjs
// 双语导出（copy-skill.mjs）的结构契约：两目录自包含、文件名归一、package.json 改写、
// viewer 语言标记注入（locale.mjs 是两份 script/ 中唯一内容被改写的文件）。
// 副作用仅写 .temp/（已 gitignore）；脚本依赖 cwd 为仓库根——node --test 从仓库根启动，天然满足。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';

const EN_DIR = '.temp/url-to-markdown';
const ZH_DIR = '.temp/url-to-markdown-zh';
const GUIDES = ['analyze_html_guide', 'markdown_skeleton_guide'];
const LOCALE_REL = 'script/lib/locale.mjs';

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

  for (const [dir, skillSrc, readmeSrc, name, locale] of [[EN_DIR, 'SKILL.md', 'README.md', 'url-to-markdown', 'en'], [ZH_DIR, 'SKILL.zh-CN.md', 'README.zh-CN.md', 'url-to-markdown-zh', 'zh']]) {
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

    // 5) viewer 语言标记按导出语言注入
    assert.match(fs.readFileSync(`${dir}/${LOCALE_REL}`, 'utf8'),
      new RegExp(`^export const SKILL_LOCALE = '${locale}';$`, 'm'), `${dir} locale 标记`);
  }

  // 6) zh 导出物内无 .zh-CN 文件名（SKILL/references/README 均已归一）
  assert.ok(!listFiles(ZH_DIR).some((f) => f.includes('zh-CN')));

  // 7) script/ 两目录唯一内容差异 = locale.mjs（其余逐字节拷贝）。
  //    自带 walker（listFiles 的递归会丢嵌套目录前缀，无法回读文件）
  const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`, `${base}${e.name}/`) : [`${base}${e.name}`]))
    .sort();
  const diffFiles = walk(`${EN_DIR}/script`)
    .filter((f) => fs.readFileSync(`${EN_DIR}/script/${f}`, 'utf8') !==
                   fs.readFileSync(`${ZH_DIR}/script/${f}`, 'utf8'));
  assert.deepEqual(diffFiles, ['lib/locale.mjs']);

  // 8) 源仓库开发态标记恒 'en'（防漂移——默认语言翻转是用户裁定）
  assert.match(fs.readFileSync(LOCALE_REL, 'utf8'), /^export const SKILL_LOCALE = 'en';$/m);

  // 9) 功能级：导出物内 resolveViewerLang 真消费标记（不只是文件在位）
  const savedLang = process.env.U2M_LANG;
  delete process.env.U2M_LANG;
  try {
    const bust = () => `?v=${Date.now()}-${Math.random()}`;
    const en = await import(pathToFileURL(`${EN_DIR}/script/lib/viewer-i18n.mjs`).href + bust());
    assert.equal(en.resolveViewerLang(), 'en', 'en 导出物默认英文 viewer');
    const zh = await import(pathToFileURL(`${ZH_DIR}/script/lib/viewer-i18n.mjs`).href + bust());
    assert.equal(zh.resolveViewerLang(), 'zh', 'zh 导出物默认中文 viewer');
    assert.equal(zh.viewerText().login.statics.doneText, '✅ 登录完成');
    assert.equal(en.viewerText().login.statics.doneText, '✅ Login Done');
  } finally {
    if (savedLang !== undefined) process.env.U2M_LANG = savedLang;
  }
});
