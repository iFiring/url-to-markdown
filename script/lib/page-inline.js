function __u2mInlineStyles(el) {
  const walk = (n) => {
    const cs = getComputedStyle(n);
    for (let i = 0; i < cs.length; i++) {
      const p = cs.item(i);
      n.style.setProperty(p, cs.getPropertyValue(p));
    }
    Array.from(n.children).forEach(walk);
  };
  walk(el);
  return el.outerHTML;
}
