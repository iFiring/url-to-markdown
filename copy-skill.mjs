#!/usr/bin/env node
/**
 * 仓库开发工具（不进导出物）。用法：pnpm run copy:skill
 * 导出两个自包含技能目录：
 *   .temp/url-to-markdown/      英文版
 *   .temp/url-to-markdown-zh/   中文版（内部文件名归一：SKILL.zh-CN.md → SKILL.md、
 *                               references/*.zh-CN.md → *.md、README.zh-CN.md → README.md）
 * README 已双语化：英文导出取 README.md、中文导出取 README.zh-CN.md，
 * 均归一为导出物内 README.md（手册链接目标本就是 SKILL.md，无须改写正文）。
 * 两份导出的 package.json 均钉死依赖版本（取自仓库 node_modules）、删除 scripts 段。
 * viewer UI 语言随导出物：script/lib/locale.mjs 是两份导出物 script/ 中唯一内容被
 * 改写的文件（en 导出物 = 'en'、zh 导出物 = 'zh'；lib/viewer-i18n.mjs 消费），
 * 其余 script/ 文件逐字节拷贝——文件名两侧一致，清单相等契约不受影响。
 */
import fs from 'node:fs';

if (!fs.existsSync('SKILL.md')) {
  console.error('[copy:skill] run from the repo root (SKILL.md not found)');
  process.exit(1);
}

const GUIDES = ['analyze_html_guide', 'markdown_skeleton_guide'];

// 导出物语言标记（两侧都显式写——幂等，且源文件万一漂移也不会带进导出物）
const LOCALE_REL = 'script/lib/locale.mjs';
const localeSrc = (zh) => `// script/lib/locale.mjs —— 导出物语言标记（copy-skill.mjs 写入，勿手改）：viewer UI 语言。
// 优先级：U2M_LANG 环境变量 > 本标记 > 'en'（lib/viewer-i18n.mjs 的 resolveViewerLang 消费）。
export const SKILL_LOCALE = '${zh ? 'zh' : 'en'}';
`;

const TARGETS = [
  { dir: '.temp/url-to-markdown',    pkgName: 'url-to-markdown',    skill: 'SKILL.md',       readme: 'README.md', zh: false },
  { dir: '.temp/url-to-markdown-zh', pkgName: 'url-to-markdown-zh', skill: 'SKILL.zh-CN.md', readme: 'README.zh-CN.md', zh: true  },
];

for (const { dir, pkgName, skill, readme, zh } of TARGETS) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(`${dir}/references`, { recursive: true });

  fs.cpSync(skill, `${dir}/SKILL.md`);
  fs.cpSync('script', `${dir}/script`, { recursive: true });
  fs.writeFileSync(`${dir}/${LOCALE_REL}`, localeSrc(zh));
  for (const base of GUIDES) {
    fs.cpSync(`references/${base}${zh ? '.zh-CN' : ''}.md`, `${dir}/references/${base}.md`);
  }
  fs.cpSync(readme, `${dir}/README.md`);

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.name = pkgName; // 与导出目录名、SKILL frontmatter name 三方一致
  for (const dep of Object.keys(pkg.dependencies)) {
    pkg.dependencies[dep] = JSON.parse(
      fs.readFileSync(`node_modules/${dep}/package.json`, 'utf8'),
    ).version;
  }
  delete pkg.scripts;
  fs.writeFileSync(`${dir}/package.json`, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[copy:skill] ${pkgName} → ${dir}/ (deps pinned, scripts removed)`);
}
