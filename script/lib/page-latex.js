/**
 * LaTeX 原文提取（共享页面脚本）。从 MathML 元素取原始 LaTeX 源，供
 * 步骤 6 瘦身规则②（page-slim-article.js）整体替换为 $…$ 文本。
 * 分级信任（高度还原原则）：
 *  - 声明了 encoding="application/x-tex" 的 <annotation>：信（KaTeX 标准）
 *  - <script type="math/tex"> 子元素 / 前邻 script：信（声明形态）
 *  - 完全未声明 encoding 的裸 <annotation>：也信——实践中是渲染器省略
 *    属性、内容即原文（参考页 developers.openai.com 19 个公式全是此
 *    方言，带 style 无 encoding）
 *  - 显式声明**非 TeX** encoding 的 <annotation>：不信——内容可能是其他
 *    格式，当 LaTeX 替换即失真；annotation:not([encoding]) 恰好只放行
 *    未声明者
 * 取不到（或裸 annotation 内容为空）返回 null / 空串，调用方按无源
 * 保留 MathML 原树兜底。
 */
function __u2mLatexText(el) {
  const ann = el.querySelector('annotation[encoding="application/x-tex"], script[type="math/tex"], script[type="math/tex; mode=display"]');
  if (ann) return (ann.textContent || '').trim();
  const prev = el.previousElementSibling;
  if (prev) {
    const t = prev.getAttribute('type') || '';
    if (/^math\/tex/.test(t)) return (prev.textContent || '').trim();
  }
  const bare = el.querySelector('annotation:not([encoding])');
  if (bare) return (bare.textContent || '').trim();
  return null;
}
