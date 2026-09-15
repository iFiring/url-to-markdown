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
 */
import fs from 'node:fs';

if (!fs.existsSync('SKILL.md')) {
  console.error('[copy:skill] run from the repo root (SKILL.md not found)');
  process.exit(1);
}

const GUIDES = ['analyze_html_guide', 'markdown_skeleton_guide'];

const TARGETS = [
  { dir: '.temp/url-to-markdown',    pkgName: 'url-to-markdown',    skill: 'SKILL.md',       readme: 'README.md', zh: false },
  { dir: '.temp/url-to-markdown-zh', pkgName: 'url-to-markdown-zh', skill: 'SKILL.zh-CN.md', readme: 'README.zh-CN.md', zh: true  },
];

for (const { dir, pkgName, skill, readme, zh } of TARGETS) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(`${dir}/references`, { recursive: true });

  fs.cpSync(skill, `${dir}/SKILL.md`);
  fs.cpSync('script', `${dir}/script`, { recursive: true });
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
