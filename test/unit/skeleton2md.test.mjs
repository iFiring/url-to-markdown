import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertSkeleton, entryToMarkdown } from '../../script/lib/skeleton2md.mjs';

// 骨架 → markdown 纯函数渲染（原步骤 9 CLI 的核心逻辑，2026-09-11 步骤 8/9
// 合并时抽 lib）。CLI 集成路径（8_markdown.md 落盘、emit 契约）由
// render-markdown.test.mjs 覆盖，本文件直测转换规则。

// 新契约（references/markdown_skeleton_guide.md）：value 自带行外语法。
// h1-h6/blockquote 以 key 为准规范化重建（LLM 漏写/写错级别也能纠正），
// p/ul/ol/table/img 透传，trans2img 为截图择优回写的选中路径。
const RESOLVED = [
  { h1: '# 标题一' },
  { p: '一段正文，含**粗体**。' },
  { h2: '# 级别写错的标题' },
  { h5: '漏写井号的标题' },
  { h1: '# #1 排行榜' },
  { blockquote: '> 单行引用' },
  { blockquote: '> 多行引用\n第二段缺前缀' },
  { ul: '- 条目一\n - 嵌套条目' },
  { ol: '1. 第一步\n2. 第二步' },
  { code: { lang: 'python', content: 'def hello():\n    print("hi")' } },
  { code: { lang: '', content: 'plain code' } },
  { img: '![img](https://example.com/a.png)' },
  { img: '![img](assets/images/cover.png)' },
  { table: '|a|b|\n|--|--|\n|1|2|' },
  { trans2img: 'assets/trans/92.webp' },
  { p: '结尾段落' },
];

test('skeleton2md: 全类型条目按新契约转换（h/blockquote 以 key 重建，其余透传）', () => {
  const md = convertSkeleton(RESOLVED);

  // 按块切分（双换行），逐条比对
  const blocks = md.split(/\n\n+/);

  assert.equal(blocks[0], '# 标题一');
  assert.equal(blocks[1], '一段正文，含**粗体**。');
  // key 为准：h2 配单 # value 重建为 ##
  assert.equal(blocks[2], '## 级别写错的标题');
  // 漏写 # 的 value 按级别补前缀
  assert.equal(blocks[3], '##### 漏写井号的标题');
  // 正文以 # 开头：只剥后随空白的 # 前缀，内容不误伤
  assert.equal(blocks[4], '# #1 排行榜');
  assert.equal(blocks[5], '> 单行引用');
  // 缺前缀的行重建为 > 开头
  assert.equal(blocks[6], '> 多行引用\n> 第二段缺前缀');
  // ul/ol 透传（嵌套缩进只在 value 里）
  assert.equal(blocks[7], '- 条目一\n - 嵌套条目');
  assert.equal(blocks[8], '1. 第一步\n2. 第二步');
  assert.equal(blocks[9], '```python\ndef hello():\n    print("hi")\n```');
  assert.equal(blocks[10], '```\nplain code\n```');
  // img 透传（远端 URL 与本地化路径两种形态）
  assert.equal(blocks[11], '![img](https://example.com/a.png)');
  assert.equal(blocks[12], '![img](assets/images/cover.png)');
  assert.equal(blocks[13], '|a|b|\n|--|--|\n|1|2|');
  // trans2img：value 为择优回写的选中路径
  assert.equal(blocks[14], '![](assets/trans/92.webp)');
  assert.equal(blocks[15], '结尾段落');
});

test('skeleton2md: 未知 key 静默跳过、空对象条目跳过', () => {
  const md = convertSkeleton([{ unknown: 'x' }, {}, { p: '仅此一条' }]);
  assert.equal(md, '仅此一条');
});

test('skeleton2md: 空骨架渲染空串', () => {
  assert.equal(convertSkeleton([]), '');
});

test('skeleton2md: trans2img 仍为 ID 数组时抛错（择优回写未生效）', () => {
  assert.throws(
    () => convertSkeleton([{ trans2img: [9, 10] }]),
    /trans2img 条目 value 应为择优回写的截图路径/
  );
});

test('skeleton2md: code value 仍为字符串（{{CODE_ 残留）抛错', () => {
  assert.throws(
    () => convertSkeleton([{ code: '{{CODE_9}}' }]),
    /引用了未还原的代码占位符/
  );
});

test('skeleton2md: 围栏 backtick 自适应——内容含 ``` 时用 4 重围栏', () => {
  const md = convertSkeleton([
    { code: { lang: 'md', content: '外层\n```\ninner fence\n```\n结尾' } },
  ]);
  assert.equal(md, '````md\n外层\n```\ninner fence\n```\n结尾\n````');
});

test('skeleton2md: 内容含 ```` 时用 5 重围栏；反引号结尾安全', () => {
  const md = convertSkeleton([
    { code: { lang: '', content: 'a\n````\nb`' } },
  ]);
  assert.equal(md, '`````\na\n````\nb`\n`````');
});

test('skeleton2md: lang 清洗——反引号/换行剥离（js`+换行+x → jsx）', () => {
  const md = convertSkeleton([
    { code: { lang: 'js`\nx', content: 'y' } },
  ]);
  // 'js`\nx' = j s 反引号 换行 x → 剥离非法字符后 'jsx'
  assert.equal(md, '```jsx\ny\n```');
});

test('skeleton2md: entryToMarkdown 未知 key 返回 null', () => {
  assert.equal(entryToMarkdown('aside', 'x'), null);
});
