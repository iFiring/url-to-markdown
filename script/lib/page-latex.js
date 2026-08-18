function __u2mLatexText(el) {
  const ann = el.querySelector('annotation[encoding="application/x-tex"], script[type="math/tex"], script[type="math/tex; mode=display"]');
  if (ann) return (ann.textContent || '').trim();
  const prev = el.previousElementSibling;
  if (prev) {
    const t = prev.getAttribute('type') || '';
    if (/^math\/tex/.test(t)) return (prev.textContent || '').trim();
  }
  return null;
}
