(() => {
  const norm = value => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const leaf = text => {
    const matches = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,p,span,div')]
      .filter(element => norm(element.textContent) === norm(text));
    return matches.sort((a, b) => a.children.length - b.children.length)[0] || null;
  };
  const common = (a, b) => {
    if (!a || !b) return null;
    const seen = new Set();
    for (let node = a; node; node = node.parentElement) seen.add(node);
    for (let node = b; node; node = node.parentElement) if (seen.has(node)) return node;
    return null;
  };
  const direct = (node, parent, className) => {
    if (!node || !parent) return null;
    let current = node;
    while (current && current.parentElement !== parent) current = current.parentElement;
    if (current && current !== parent) {
      current.classList.add(className);
      return current;
    }
    return null;
  };
  const apply = () => {
    const fields = [...document.querySelectorAll('input,textarea')];
    const editor = fields.find(element => /tulis\s+update\s+progress/i.test(element.getAttribute('placeholder') || ''));
    if (!editor) return;
    let composer = editor.parentElement;
    while (composer && composer !== document.body) {
      const hasPic = [...composer.querySelectorAll('input,textarea')].some(element => /pic/i.test(element.getAttribute('placeholder') || ''));
      const hasAdd = [...composer.querySelectorAll('button')].some(button => norm(button.textContent) === 'add' || /\badd\b/.test(norm(button.textContent)));
      if (hasPic && hasAdd) break;
      composer = composer.parentElement;
    }
    if (!composer || composer === document.body) return;
    composer.classList.add('ptl-composer');
    const title = leaf('Progress timeline');
    if (title) title.classList.add('ptl-title');
    const section = common(title, composer);
    if (section) section.classList.add('ptl-section');
    const pic = fields.find(element => composer.contains(element) && /pic/i.test(element.getAttribute('placeholder') || ''));
    const add = [...composer.querySelectorAll('button')].find(button => norm(button.textContent) === 'add' || /\badd\b/.test(norm(button.textContent)));
    const inputs = [...composer.querySelectorAll('input')].filter(element => element !== editor && element !== pic);
    const date = inputs.find(element => element.type === 'date') || inputs[0];
    const time = inputs.find(element => element.type === 'time') || inputs.find(element => element !== date);
    direct(date, composer, 'ptl-date-wrap');
    direct(time, composer, 'ptl-time-wrap');
    direct(editor, composer, 'ptl-message-wrap');
    direct(pic, composer, 'ptl-pic-wrap');
    direct(add, composer, 'ptl-add-wrap');
    const nowButton = [...document.querySelectorAll('button')].find(button => /waktu sekarang/i.test(button.textContent || ''));
    if (nowButton) {
      nowButton.classList.add('ptl-now-btn');
      const header = common(title, nowButton);
      if (header && header !== section) header.classList.add('ptl-header');
    }
    const labels = [
      'we already open tt', 'team confirm prepare tools', 'team otw lokasi', 'team tiba di lokasi',
      'team proses pengecekan', 'team proses pencarian physical cp', 'team proses kupas kabel kedua sisi',
      'team proses setting jc', 'team progress penyambungan', 'confirm link normal tt closed',
    ];
    const chips = [...document.querySelectorAll('button')].filter(button => labels.includes(norm(button.textContent)));
    chips.forEach(button => button.classList.add('ptl-preset-chip'));
    if (chips.length) {
      let holder = chips[0].parentElement;
      while (holder && holder !== section && !chips.every(button => holder.contains(button))) holder = holder.parentElement;
      if (holder && holder !== section) holder.classList.add('ptl-presets');
    }
    const emptyTitle = leaf('Timeline masih kosong');
    const emptySubtitle = leaf('Tambahkan update pertama menggunakan composer di atas.');
    if (emptyTitle) emptyTitle.classList.add('ptl-empty-title');
    if (emptySubtitle) emptySubtitle.classList.add('ptl-empty-subtitle');
    let empty = common(emptyTitle, emptySubtitle);
    if (empty && empty.parentElement && empty.parentElement !== section) empty = empty.parentElement;
    if (empty && empty !== section) empty.classList.add('ptl-empty');
  };
  let raf = 0;
  const queue = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(apply);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queue, { once: true });
  else queue();
  new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true });
})();
