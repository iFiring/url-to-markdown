/**
 * skeleton2md.mjs —— 骨架 → markdown 纯函数渲染（原步骤 9 render_skeleton.mjs
 * 的核心逻辑，2026-09-11 步骤 8/9 合并时平移抽 lib）。被步骤 8
 * render_markdown.mjs 在占位符还原 + 图片下载 + trans2img 择优回写之后调用。
 *
 * 转换规则（契约见 references/markdown_skeleton_guide.md：value 已带行外
 * 语法——#、>、- 、1.、![img](url) 由步骤 7 写好，行内 markdown 同理）：
 *   h1-h6       以 key 为准重建：剥 value 自带 # 前缀（仅剥后随空白者，
 *               「#1 排行榜」这类正文不误伤）后按级别补 "#"*N——LLM 漏写
 *               /写错级别也能纠正
 *   blockquote  以 key 为准重建：剥行首 > 后逐行补 "> "
 *   p / ul / ol / table / img   透传（嵌套缩进、管线表、![img](url) 只存在于
 *               value；img 经图片下载后或为 ![img](assets/images/x) 本地形态）
 *   code        "```{lang}" 围栏（lang 缺省时仅 "```"）
 *   trans2img   value 为择优回写的选中路径 assets/trans/{id}.webp →
 *               ![]({path})；仍是 ID 数组 → 抛错（管线内部错误——同进程
 *               择优回写先行，到达此处说明状态异常）
 *   未知 key 静默跳过；空骨架渲染空串
 */

// 单条骨架 → markdown 字符串。未知 key 返回 null（被 convertSkeleton 过滤）。
// trans2img 的 value 不是字符串（如仍是 ID 数组）时抛错——择优回写未生效。
function entryToMarkdown(key, value) {
  // h1-h6：以 key 级别为准重建——key 才是语义判定载体
  if (/^h[1-6]$/.test(key)) {
    const level = +key[1];
    const text = String(value).trim().replace(/^#{1,6}[ \t]+/, '');
    return `${'#'.repeat(level)} ${text}`;
  }

  switch (key) {
    case 'p':
    case 'ul':
    case 'ol':
    case 'table':
      return String(value).trim();

    case 'blockquote': {
      const lines = String(value).trim().split('\n');
      return lines.map((l) => `> ${l.replace(/^[ \t]*>[ \t]?/, '')}`).join('\n');
    }

    case 'code': {
      // 残留守卫：{{CODE_k}} 引用已在本步骤物化为对象；仍为字符串 = 引用了
      // 未还原的代码占位符（2_code.json 中不存在或 failed 的 k 保留字面）。
      // 残留流到最终 markdown 是静默损坏的代码块——宁可响亮失败（镜像
      // trans2img 守卫）。
      if (!value || typeof value !== 'object') {
        throw new Error(
          `code 条目 value 应为 {lang, content} 对象，实际为: ${JSON.stringify(value)}——引用了未还原的代码占位符（2_code.json 中不存在或 failed），请按步骤 7 指南修正 7_skeleton.json 后重跑步骤 8`
        );
      }
      // lang 来自 data-language 属性链，可能携垃圾字符（反引号/换行会破坏围栏
      // 首行）——剥离非法字符，空则裸围栏
      const lang = String(value.lang || '').replace(/[^a-zA-Z0-9._+-]/g, '');
      const content = String(value.content || '');
      // GFM 围栏安全：围栏严格长于内容中任何反引号连续串即不可被内容闭合；
      // 内容以反引号结尾亦无碍（换行 + 更长围栏）。对 LLM 自转路径同样生效。
      const maxRun = (content.match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length), 0);
      const fence = '`'.repeat(Math.max(3, maxRun + 1));
      return `${fence}${lang}\n${content}\n${fence}`;
    }

    case 'img':
      // value 已是 ![img](url) / ![img](assets/images/x) 完整 markdown，透传
      return String(value).trim();

    case 'trans2img': {
      if (typeof value !== 'string') {
        throw new Error(
          `trans2img 条目 value 应为择优回写的截图路径，实际为: ${JSON.stringify(value)}（管线内部错误——择优回写未生效）`
        );
      }
      return `![](${value})`;
    }

    default:
      return null;
  }
}

// 骨架数组 → markdown 字符串：逐条转换、空行分块。未知 key 跳过。
function convertSkeleton(skeleton) {
  const blocks = [];
  for (const entry of skeleton) {
    const keys = Object.keys(entry);
    if (keys.length === 0) continue;
    const key = keys[0];
    const md = entryToMarkdown(key, entry[key]);
    if (md !== null) blocks.push(md);
  }
  return blocks.join('\n\n');
}

export { entryToMarkdown, convertSkeleton };
