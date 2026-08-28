/**
 * 步骤 5 函数值收集。在浏览器 evaluate 中执行，运行于 juice 内联后的页面
 * （<style> 已移除、style 属性已就位），返回需要真实值替换的声明对：
 *   [{ id: data-u2m-id, props: [属性名, …] }, …]
 * 收集条件：style 属性声明值含函数间接引用——var() / color-mix() / calc()，
 * 或值为空串（简写属性带 var 的 CSSOM 形态：如 border-style: var(--x) 在
 * 本页（无样式表、变量不可解析）被展开为 border-top-style 等 longhand 且
 * getPropertyValue 返回空串，序列化时才还原 var() 文本——空串收集不到
 * 就会原样漏进终态）。
 * 为什么需要：juice 对多级 var 链的递归解析会弄丢 color-mix 的颜色空间
 * 参数（产出 `color-mix(rgb(…) 10%, transparent)` 非法值，浏览器整条
 * 丢弃）；@property 注册的变量与 calc() 则保持字面函数引用。这些值要拿
 * 原样式页（lib/page-resolve-computed.js）上浏览器的 getComputedStyle
 * 计算值替换。
 * 属性名保持 CSSOM item() 原样（小写长属性名），与 resolve/finalize 的
 * map 键一致。
 */
function __u2mCollectFnValues() {
  var FUNC_RE = /var\(|color-mix\(|calc\(/i;
  var out = [];
  var styled = document.querySelectorAll('[style]');
  for (var i = 0; i < styled.length; i++) {
    var st = styled[i].style;
    var props = [];
    for (var j = 0; j < st.length; j++) {
      var p = st.item(j);
      var v = st.getPropertyValue(p);
      if (v === '' || FUNC_RE.test(v)) props.push(p);
    }
    if (props.length > 0) {
      out.push({ id: styled[i].getAttribute('data-u2m-id'), props: props });
    }
  }
  return out;
}
