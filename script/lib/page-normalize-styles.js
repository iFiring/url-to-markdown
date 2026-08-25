/**
 * 步骤 5 预处理：style 属性字符串 token 规范化。在浏览器 evaluate 中执行，
 * 返回规范化后的整页 HTML（<!DOCTYPE html> + outerHTML）。
 * 为什么需要：juice 写回 style 属性时把声明值里的每个 " 无条件换成 '
 * （juice/lib/inline.js setStyleAttrs 的 value.replace(/["]/g, "'")），
 * 双引号字符串内含撇号（"D'Nealian"、url("…men's-tshirt.png")）或单双引号
 * 混排的值会被改写成未闭合字符串——浏览器解析时吞掉同属性后续声明。
 * 进 juice 前把所有字符串 token 重引为单引号、内层裸引号一律反斜杠转义
 * （'D\'Nealian'、'a\"b'），juice 写回的 " → ' 就只会作用于 \" → \'（仍是
 * 合法转义），任何形状都不再损毁。
 * 在浏览器里做而非 Node 正则：DOM 天然只圈中 style 属性——data-style 等
 * 后缀属性、<style> 原文区与正文文本不会被波及，实体转义域由解析器保证。
 */
function __u2mNormalizeStyleStrings() {
  function normalizeValue(cssText) {
    var out = '';
    var i = 0;
    var n = cssText.length;
    while (i < n) {
      var c = cssText.charAt(i);
      if (c === '/' && cssText.charAt(i + 1) === '*') {
        // 注释原样透传
        var end = cssText.indexOf('*/', i + 2);
        var stop = end === -1 ? n : end + 2;
        out += cssText.slice(i, stop);
        i = stop;
        continue;
      }
      if (c !== '"' && c !== "'") {
        out += c;
        i += 1;
        continue;
      }
      // 字符串 token：读至闭合引号（\x 转义对原样保留），重引为 '…'
      var j = i + 1;
      var content = '';
      var closed = false;
      while (j < n) {
        var d = cssText.charAt(j);
        if (d === '\\' && j + 1 < n) {
          content += d + cssText.charAt(j + 1);
          j += 2;
          continue;
        }
        if (d === c) {
          closed = true;
          break;
        }
        // 与定界符相反的内层裸引号转义（等价写法，内容不变）
        if (d === '"' || d === "'") content += '\\' + d;
        else content += d;
        j += 1;
      }
      if (!closed) return cssText; // 未闭合属非法输入，原样透传不恶化
      out += "'" + content + "'";
      i = j + 1;
    }
    return out;
  }

  var styled = document.querySelectorAll('[style]');
  for (var k = 0; k < styled.length; k++) {
    var val = styled[k].getAttribute('style');
    if (val) styled[k].setAttribute('style', normalizeValue(val));
  }
  return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
}
