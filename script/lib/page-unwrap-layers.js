/**
 * 步骤 5 预处理：解包 <style> 里的 @layer 级联层。在浏览器 evaluate 中
 * 执行，返回处理后的整页 HTML（<!DOCTYPE html> + outerHTML）。
 * 为什么需要：Tailwind v4 把工具类规则包在 `@layer utilities { … }` 里
 * （真实站点 developers.openai.com 实测 56% 的 CSS 在层内），而 juice 不
 * 进入 @layer 块——不解包则层内规则一条都内联不进去，只靠工具类表达
 * 样式的元素（卡片边框/圆角/背景）在步骤 5 后一丝样式不剩，步骤 7 LLM
 * 丢失「这是个带边框的视觉模块」结构信号。
 * 处理（对每个 <style> 的文本）：
 *   - 块形 `@layer <name>? { … }`：递归解包层体后原位替换（内层规则提升
 *     到外层，文档顺序不变——层间的先后次序仍由位置表达）；层内嵌套的
 *     @layer / @media 一并随层体上提
 *   - 声明形 `@layer a, b;`：整段丢弃（仅声明层序，无规则体）
 * 扫描跳过注释与字符串 token（content:"{" 一类不会误配花括号）。
 * 级联语义说明：解包把「层内规则」变为「未分层规则」，与站点手写的
 * 未分层规则之间的优先级由原先后关系变为按特异性+顺序裁定——对白名单
 * 信号提取可接受（原本层内样式浏览器里优先级低于未分层规则，juice 侧
 * 本就不做层模拟）。
 * 在浏览器里做而非 Node 正则：DOM 天然只圈中真正的 <style> 标签——正文
 * 代码示例里字面的 @layer 文本不会被波及。
 */
function __u2mUnwrapLayers() {
  function unwrapCss(css) {
    var out = '';
    var i = 0;
    var n = css.length;
    while (i < n) {
      var c = css.charAt(i);
      // 注释原样透传
      if (c === '/' && css.charAt(i + 1) === '*') {
        var end = css.indexOf('*/', i + 2);
        var stop = end === -1 ? n : end + 2;
        out += css.slice(i, stop);
        i = stop;
        continue;
      }
      // 字符串 token 原样透传（\x 转义跨过）
      if (c === '"' || c === "'") {
        var j = i + 1;
        while (j < n) {
          var d = css.charAt(j);
          if (d === '\\') { j += 2; continue; }
          if (d === c) { j++; break; }
          j++;
        }
        out += css.slice(i, j);
        i = j;
        continue;
      }
      // @layer（at 关键字 ASCII 大小写不敏感）
      if (c === '@' && css.slice(i, i + 6).toLowerCase() === '@layer') {
        // 名字段内不会有引号/花括号/分号，向后找首个 { 或 ; 即可判形
        var k = i + 6;
        while (k < n && css.charAt(k) !== '{' && css.charAt(k) !== ';') k++;
        if (css.charAt(k) === ';') { i = k + 1; continue; } // 声明形：丢弃
        if (css.charAt(k) === '{') {
          // 花括号配平找层体闭合（跳过注释与字符串）
          var depth = 1;
          var m = k + 1;
          var closed = false;
          while (m < n) {
            var ch = css.charAt(m);
            if (ch === '/' && css.charAt(m + 1) === '*') {
              var end2 = css.indexOf('*/', m + 2);
              m = end2 === -1 ? n : end2 + 2;
              continue;
            }
            if (ch === '"' || ch === "'") {
              var j2 = m + 1;
              while (j2 < n) {
                var d2 = css.charAt(j2);
                if (d2 === '\\') { j2 += 2; continue; }
                if (d2 === ch) { j2++; break; }
                j2++;
              }
              m = j2;
              continue;
            }
            if (ch === '{') depth++;
            else if (ch === '}') {
              depth--;
              if (depth === 0) { closed = true; break; }
            }
            m++;
          }
          // 层体递归解包后原位替换；未闭合的残缺输入按整段余文处理不恶化
          var bodyEnd = closed ? m : n;
          out += unwrapCss(css.slice(k + 1, bodyEnd));
          i = bodyEnd + 1;
          continue;
        }
        // 文件尾残缺（无 { 无 ;）：原样透传
        out += css.slice(i);
        i = n;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  var styleEls = document.querySelectorAll('style');
  for (var t = 0; t < styleEls.length; t++) {
    styleEls[t].textContent = unwrapCss(styleEls[t].textContent || '');
  }
  return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
}
