function __u2mClean() {
  document.querySelectorAll('video,audio,button,[role="button"],.copy,.copy-btn').forEach((e) => e.remove());
  document.querySelectorAll('.line-numbers-rows,[data-line-number]').forEach((e) => e.remove());
  // 行号列：pre 内 table 首列为纯数字的单元格 / 纯数字 li
  document.querySelectorAll('pre table tr').forEach((tr) => {
    const c = tr.firstElementChild;
    if (c && /^\s*\d+\s*$/.test(c.textContent || '')) c.remove();
  });
  document.querySelectorAll('pre ol > li').forEach((li) => {
    if (/^\s*\d+\s*$/.test(li.textContent || '')) li.remove();
  });
  return true;
}
