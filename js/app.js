// ==========================================================
// js/app.js
// Construye las diapositivas a partir de js/slides.js, maneja la
// navegación (teclado, botones, gestos, índice), los botones de
// copiar, el cambio de tema y conecta cada diapositiva con la
// escena de three.js (js/scene.js).
// ==========================================================

(function () {
  'use strict';

  const SLIDES = window.SLIDES;
  const FILES = window.CODE_FILES;
  const PIPE = window.PIPELINE;
  const ARCH = window.ARCHITECTURE;
  const PHASES = window.PHASES;
  const hljs = window.hljs;
  const Scene = window.Scene || {};
  const THEME_KEY = 'persona-api-diapositivas-tema';

  document.documentElement.lang = 'es';

  // ---------------------------------------------------------- utilidades
  let uid = 0;
  const pad = (n) => String(n).padStart(2, '0');
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style') node.style.cssText = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const svg = (paths, extra = '') => `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" ${extra}>${paths}</svg>`;
  const ICON = {
    left: svg('<path d="M10 3.5 5.5 8l4.5 4.5"/>'),
    right: svg('<path d="m6 3.5 4.5 4.5L6 12.5"/>'),
    list: svg('<path d="M6 4h7.5M6 8h7.5M6 12h7.5"/><path d="M2.5 4h.5M2.5 8h.5M2.5 12h.5"/>'),
    sun: svg('<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"/>'),
    moon: svg('<path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z"/>'),
    copy: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>'),
    check: svg('<path d="m3 8.5 3.2 3L13 4.5"/>'),
    file: svg('<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>'),
    play: svg('<path d="M5 3.4v9.2l7.2-4.6z" fill="currentColor"/>'),
    close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
    chevron: svg('<path d="m4.5 6 3.5 3.5L11.5 6"/>'),
    folder: svg('<path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.4 1.6H13c.7 0 1.2.5 1.2 1.2v6.2c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z"/>'),
  };

  function badgeFor(name) {
    if (name.endsWith('.js')) return ['JS', 'fb-js'];
    if (name.endsWith('.json')) return ['{ }', 'fb-json'];
    if (name.endsWith('.sql')) return ['SQL', 'fb-sql'];
    if (name.endsWith('.md')) return ['MD', 'fb-md'];
    if (name.startsWith('.env')) return ['ENV', 'fb-env'];
    if (name === '.gitignore') return ['GIT', 'fb-git'];
    return ['TXT', 'fb-txt'];
  }

  function langLabel(tab) {
    if (tab.file === '.gitignore') return 'Ignore';
    if (tab.file && tab.file.startsWith('.env')) return 'Dotenv';
    return { javascript: 'JavaScript', sql: 'SQL', json: 'JSON' }[tab.lang] || tab.lang;
  }

  function highlight(code, lang) {
    if (hljs && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    return escapeHtml(code);
  }

  function methodBadge(method) {
    return el('span', { class: 'method', dataset: { m: method }, text: method });
  }

  // Copiar al portapapeles, con respaldo de selección manual
  function copyText(text, button, fallbackEl) {
    const label = button.querySelector('.btn-text');
    const original = label ? label.textContent : '';
    const done = (msg, ok) => {
      button.classList.toggle('is-done', ok);
      if (label) label.textContent = msg;
      clearTimeout(button._timer);
      button._timer = setTimeout(() => {
        button.classList.remove('is-done');
        if (label) label.textContent = original;
      }, 1800);
    };
    const selectFallback = () => {
      if (fallbackEl) {
        const range = document.createRange();
        range.selectNodeContents(fallbackEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      done('Selecciona y copia', false);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done('Copiado', true), selectFallback);
    } else {
      selectFallback();
    }
  }

  function copyButton(labelText, getText, getFallback, extraClass = '') {
    const btn = el('button', { class: `copy-btn ${extraClass}`.trim(), type: 'button', 'aria-label': `${labelText} al portapapeles` },
      el('span', { class: 'btn-icon', html: ICON.copy }),
      el('span', { class: 'btn-text', text: labelText }));
    btn.addEventListener('click', () => copyText(getText(), btn, getFallback()));
    return btn;
  }

  // ---------------------------------------------------------- componentes: editor de código
  function codeFor(tab) {
    if (tab.text != null) {
      const total = tab.text.split('\n').length;
      return { text: tab.text, start: 1, end: total, total, full: tab.text };
    }
    const full = FILES[tab.file];
    const all = full.split('\n');
    const [a, b] = tab.range || [1, all.length];
    return { text: all.slice(a - 1, b).join('\n'), start: a, end: b, total: all.length, full };
  }

  function renderEditor(tabs, caption) {
    const id = `ed${uid++}`;
    const figure = el('figure', { class: 'editor-figure reveal' });
    if (caption) figure.append(el('figcaption', { class: 'visual-caption', text: caption }));
    const win = el('div', { class: 'editor on-dark' });
    const tablist = el('div', { class: 'editor-tabs', role: 'tablist', 'aria-label': 'Archivos abiertos' });
    const actions = el('div', { class: 'editor-actions' });
    win.append(el('div', { class: 'editor-bar' }, el('span', { class: 'win-dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), tablist, actions));

    let active = 0;
    const panes = tabs.map((tab, i) => {
      const code = codeFor(tab);
      const name = tab.title || tab.file.split('/').pop();
      const [badgeText, badgeClass] = badgeFor(tab.file ? name : 'x.json');
      const tabBtn = el('button', {
        class: 'editor-tab', role: 'tab', type: 'button', id: `${id}-tab${i}`,
        'aria-controls': `${id}-pane${i}`, 'aria-selected': i === 0 ? 'true' : 'false', tabindex: i === 0 ? '0' : '-1',
      }, el('span', { class: `file-badge ${badgeClass}`, text: badgeText }), el('span', { text: name }));
      tablist.append(tabBtn);

      const pane = el('div', { class: 'editor-pane', role: 'tabpanel', id: `${id}-pane${i}`, 'aria-labelledby': tabBtn.id, hidden: i !== 0 });
      if (tab.file) {
        const parts = ['persona-api', ...tab.file.split('/')];
        pane.append(el('div', { class: 'editor-crumbs', 'aria-hidden': 'true' },
          parts.map((p, j) => (j < parts.length - 1 ? [el('span', { text: p }), el('span', { class: 'crumb-sep', text: '›' })] : el('span', { class: 'crumb-file', text: p })))));
      }

      const lines = code.text.split('\n');
      const focusLines = new Set();
      (tab.focus || []).forEach(([a, b]) => { for (let n = a; n <= b; n++) focusLines.add(n); });
      const gutter = el('pre', { class: 'gutter', 'aria-hidden': 'true' });
      gutter.innerHTML = lines.map((_, j) => {
        const n = code.start + j;
        return focusLines.has(n) ? `<span class="is-focus">${n}</span>` : `<span>${n}</span>`;
      }).join('\n');
      const pre = el('pre', { class: 'code' }, el('code', { class: `hljs language-${tab.lang}`, html: highlight(code.text, tab.lang) }));
      const grid = el('div', { class: 'code-grid' });
      (tab.focus || []).forEach(([a, b]) => grid.append(el('div', { class: 'focus-band', 'aria-hidden': 'true', style: `--i:${a - code.start};--n:${b - a + 1}` })));
      grid.append(gutter, pre);
      const body = el('div', { class: 'editor-body', tabindex: '0', role: 'region', 'aria-label': `Código de ${name}` }, grid);
      pane.append(body);

      const lineInfo = tab.range ? `Líneas ${code.start}–${code.end} de ${code.total}` : `${code.total} líneas`;
      pane.append(el('div', { class: 'editor-status' },
        el('span', { class: 'status-branch', text: 'main' }),
        el('span', { text: tab.status || langLabel(tab) }),
        el('span', { class: 'status-hide-sm', text: 'UTF-8' }),
        el('span', { class: 'status-hide-sm', text: 'Espacios: 2' }),
        el('span', { class: 'status-right', text: lineInfo })));
      win.append(pane);
      return { tab, code, pane, tabBtn, pre };
    });

    actions.append(copyButton('Copiar', () => panes[active].code.text, () => panes[active].pre));
    if (tabs.some((t) => t.range)) {
      actions.append(copyButton('Archivo completo', () => panes[active].code.full, () => panes[active].pre, 'copy-btn--secondary'));
    }

    const select = (i) => {
      active = i;
      panes.forEach((p, j) => {
        p.tabBtn.setAttribute('aria-selected', j === i ? 'true' : 'false');
        p.tabBtn.tabIndex = j === i ? 0 : -1;
        p.pane.hidden = j !== i;
      });
      revealFocus(win);
    };
    panes.forEach((p, i) => p.tabBtn.addEventListener('click', () => select(i)));
    tablist.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      e.stopPropagation();
      const next = (active + (e.key === 'ArrowRight' ? 1 : -1) + panes.length) % panes.length;
      select(next);
      panes[next].tabBtn.focus();
    });

    figure.append(win);
    return figure;
  }

  // Desplaza el editor para que las líneas resaltadas queden a la vista
  function revealFocus(root) {
    root.querySelectorAll('.editor-pane:not([hidden]) .editor-body').forEach((body) => {
      const band = body.querySelector('.focus-band');
      if (!band) return;
      body.scrollTop = 0;
      const top = band.getBoundingClientRect().top - body.getBoundingClientRect().top;
      if (top + band.offsetHeight > body.clientHeight - 12) body.scrollTop = Math.max(0, top - 36);
    });
  }

  // ---------------------------------------------------------- componentes: terminal
  function terminalHtml(code) {
    let continued = false;
    return code.split('\n').map((line) => {
      const prompt = continued ? '<span class="prompt prompt--cont" aria-hidden="true"> </span>' : '<span class="prompt" aria-hidden="true">$</span>';
      continued = line.trimEnd().endsWith('\\');
      return prompt + highlight(line, 'bash');
    }).join('\n');
  }

  function renderTerminal(code, { label, extraAction, reveal = true } = {}) {
    const codeEl = el('code', { class: 'hljs language-bash', html: terminalHtml(code) });
    const pre = el('pre', {}, codeEl);
    const term = el('div', { class: `terminal on-dark${reveal && !label ? ' reveal' : ''}` });
    const bar = el('div', { class: 'terminal-bar' },
      el('span', { class: 'terminal-title' }, el('span', { class: 'terminal-glyph', text: '>_' }), 'terminal · persona-api'));
    const tools = el('div', { class: 'terminal-tools' });
    if (extraAction) tools.append(extraAction);
    term._code = code;
    tools.append(copyButton('Copiar', () => term._code, () => pre));
    bar.append(tools);
    term.append(bar, el('div', { class: 'terminal-body', tabindex: '0', role: 'region', 'aria-label': 'Comando de terminal' }, pre));
    term.setCode = (next) => {
      term._code = next;
      codeEl.innerHTML = terminalHtml(next);
    };
    if (!label) return term;
    return el('div', { class: `cmd${reveal ? ' reveal' : ''}` }, el('p', { class: 'cmd-label', text: label }), term);
  }

  // ---------------------------------------------------------- componentes: otros paneles
  function renderTable(spec) {
    return el('div', { class: 'table-wrap reveal' },
      el('table', { class: 'data-table' },
        el('thead', {}, el('tr', {}, spec.head.map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, spec.rows.map((row) => el('tr', {}, row.map((cell) => el('td', { html: cell })))))));
  }

  function renderEndpoints(rows) {
    return el('div', { class: 'table-wrap reveal' },
      el('table', { class: 'data-table data-table--endpoints' },
        el('thead', {}, el('tr', {}, ['Verbo', 'Ruta', 'Acción'].map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, rows.map(([m, path, action]) => el('tr', {},
          el('td', {}, methodBadge(m)), el('td', { class: 'mono', text: path }), el('td', { text: action }))))));
  }

  function renderChecklist(items) {
    return el('div', { class: 'checklist reveal' }, items.map((item) => el('div', { class: 'check-card' },
      el('span', { class: 'check-name', text: item.name }),
      el('span', { class: 'check-detail', text: item.detail }),
      el('code', { class: 'check-cmd', text: item.cmd }))));
  }

  function renderPackages(rows) {
    return el('figure', { class: 'panel reveal' },
      el('figcaption', { class: 'panel-head' }, el('span', { class: 'panel-kicker', text: 'package.json' }), el('span', { text: 'Dependencias del proyecto' })),
      el('div', { class: 'table-wrap table-wrap--flush' },
        el('table', { class: 'data-table' },
          el('thead', {}, el('tr', {}, ['Paquete', 'Para qué sirve', 'Tipo'].map((h) => el('th', { scope: 'col', text: h })))),
          el('tbody', {}, rows.map(([name, desc, dev]) => el('tr', {},
            el('td', { class: 'mono strong', text: name }),
            el('td', { text: desc }),
            el('td', {}, el('span', { class: `dep-tag${dev ? ' dep-tag--dev' : ''}`, text: dev ? 'desarrollo' : 'producción' }))))))));
  }

  function renderExplorer(spec) {
    const list = el('ul', { class: 'tree' }, spec.tree.map((item) => {
      const isDir = item.type === 'dir';
      const [badgeText, badgeClass] = badgeFor(item.name);
      return el('li', { class: `tree-row is-${item.type}${item.muted ? ' is-muted' : ''}`, style: `--depth:${item.depth}` },
        el('span', { class: 'tree-chevron', html: isDir ? ICON.chevron : '' }),
        isDir ? el('span', { class: 'tree-icon tree-icon--dir', html: ICON.folder }) : el('span', { class: `tree-icon file-badge ${badgeClass}`, text: badgeText }),
        el('span', { class: 'tree-name', text: isDir ? `${item.name}/` : item.name }),
        item.note ? el('span', { class: 'tree-note', text: `# ${item.note}` }) : null);
    }));
    return el('figure', { class: 'explorer on-dark reveal' },
      el('figcaption', { class: 'explorer-head' }, el('span', { class: 'explorer-kicker', text: 'Explorador' }), el('span', { text: spec.title })),
      el('div', { class: 'tree-wrap', tabindex: '0', role: 'region', 'aria-label': 'Árbol de archivos' }, list));
  }

  function renderOutput(spec) {
    const html = `<span class="prompt" aria-hidden="true">$</span>${highlight(spec.command, 'bash')}\n`
      + `<span class="out-muted">[nodemon] starting \`node index.js\`</span>\n`
      + spec.lines.map((l) => `<span class="out-line">${escapeHtml(l)}</span>`).join('\n')
      + '\n<span class="cursor" aria-hidden="true"></span>';
    return el('figure', { class: 'editor-figure reveal' },
      el('figcaption', { class: 'visual-caption', text: spec.title }),
      el('div', { class: 'terminal terminal--output on-dark' },
        el('div', { class: 'terminal-bar' }, el('span', { class: 'terminal-title' }, el('span', { class: 'terminal-glyph', text: '>_' }), 'terminal · persona-api')),
        el('div', { class: 'terminal-body', tabindex: '0', role: 'region', 'aria-label': 'Salida de la consola' }, el('pre', {}, el('code', { class: 'hljs', html })))));
  }

  function renderCollection(spec) {
    return el('figure', { class: 'collection on-dark reveal' },
      el('figcaption', { class: 'collection-head' },
        el('span', { class: 'collection-name', text: spec.name }),
        el('span', { class: 'collection-count', text: `${spec.items.length} peticiones` })),
      el('div', { class: 'collection-var' },
        el('span', { class: 'var-key', text: `{{${spec.variable[0]}}}` }),
        el('span', { class: 'var-eq', text: '=' }),
        el('span', { class: 'var-value', text: spec.variable[1] })),
      el('ul', { class: 'collection-list' }, spec.items.map(([m, name, url]) => el('li', { class: 'collection-item' },
        methodBadge(m),
        el('span', { class: 'collection-item-name', text: name }),
        el('span', { class: 'collection-item-url', text: url })))));
  }

  function renderArchitecture() {
    const grid = el('div', { class: 'arch', 'data-graph': '' });
    ARCH.main.forEach((row, i) => grid.append(el('div', { class: 'arch-node', dataset: { node: row.id }, style: `grid-row:${i + 1}` },
      el('span', { class: 'arch-label', text: row.label }),
      el('span', { class: 'arch-note', text: row.note }))));
    ARCH.side.forEach((side) => {
      const row = ARCH.main.findIndex((r) => r.id === side.row) + 1;
      grid.append(el('div', { class: 'arch-node arch-node--side', dataset: { node: side.id }, style: `grid-row:${row}` },
        el('span', { class: 'arch-label', text: side.label }),
        el('span', { class: 'arch-note', text: side.note })));
    });
    return el('figure', { class: 'arch-figure reveal' },
      el('figcaption', { class: 'visual-caption', text: 'Arquitectura en capas: el recorrido de una petición' }), grid);
  }

  function renderBitHome(extraClass, caption) {
    const home = el('div', { class: `bit-home ${extraClass || ''}`.trim(), 'data-bit-slot': '' },
      el('button', { class: 'bit-hit', type: 'button', 'aria-label': 'Saludar a Bit', onclick: () => Scene.poke && Scene.poke() }),
      fallbackRobot());
    if (!caption) return home;
    return el('div', { class: 'bit-stage reveal' }, home, el('p', { class: 'visual-caption bit-caption', text: caption }));
  }

  function fallbackRobot() {
    return el('span', {
      class: 'bit-fallback',
      'aria-hidden': 'true',
      html: '<svg viewBox="0 0 120 150"><rect x="56" y="6" width="8" height="18" rx="3" class="fb-shade"/><circle cx="60" cy="10" r="8" class="fb-accent"/><rect x="8" y="26" width="104" height="78" rx="28" class="fb-body"/><rect x="21" y="39" width="78" height="52" rx="16" class="fb-screen"/><rect x="39" y="53" width="12" height="17" rx="6" class="fb-eye"/><rect x="69" y="53" width="12" height="17" rx="6" class="fb-eye"/><rect x="30" y="110" width="60" height="36" rx="14" class="fb-body"/></svg>',
    });
  }

  // ---------------------------------------------------------- tester de peticiones (paso 22)
  function renderTester(spec, textCol, visualCol) {
    const requests = spec.requests;
    const list = el('div', { class: 'req-list reveal', role: 'tablist', 'aria-label': 'Peticiones de prueba', 'aria-orientation': 'vertical' });
    const sendBtn = el('button', { class: 'send-btn', type: 'button' }, el('span', { class: 'btn-icon', html: ICON.play }), el('span', { class: 'btn-text', text: 'Enviar' }));
    const term = renderTerminal(requests[0].curl, { extraAction: sendBtn });
    const status = el('span', { class: 'status-pill' });
    const jsonCode = el('code', { class: 'hljs language-json' });
    const jsonPre = el('pre', { class: 'code' }, jsonCode);
    const response = el('figure', { class: 'response editor on-dark reveal' },
      el('figcaption', { class: 'editor-bar response-bar' },
        el('span', { class: 'response-title', text: 'Respuesta de ejemplo' }), status),
      el('div', { class: 'editor-body', tabindex: '0', role: 'region', 'aria-label': 'Respuesta JSON' }, el('div', { class: 'code-grid code-grid--plain' }, jsonPre)));
    let selected = 0;

    const buttons = requests.map((req, i) => {
      const btn = el('button', { class: 'req-btn', type: 'button', role: 'tab', 'aria-selected': i === 0 ? 'true' : 'false', tabindex: i === 0 ? '0' : '-1' },
        methodBadge(req.method), el('span', { class: 'req-label', text: req.label }), el('span', { class: 'req-path', text: req.path }));
      btn.addEventListener('click', () => select(i));
      list.append(btn);
      return btn;
    });

    function select(i) {
      selected = i;
      const req = requests[i];
      buttons.forEach((b, j) => {
        b.setAttribute('aria-selected', j === i ? 'true' : 'false');
        b.tabIndex = j === i ? 0 : -1;
      });
      term.setCode(req.curl);
      status.textContent = `${req.status} ${req.statusText}`;
      status.classList.toggle('is-error', !!req.error);
      jsonCode.innerHTML = highlight(JSON.stringify(req.response, null, 2), 'json');
    }

    list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const next = (selected + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      select(next);
      buttons[next].focus();
    });

    sendBtn.addEventListener('click', () => {
      if (sendBtn.disabled) return;
      sendBtn.disabled = true;
      sendBtn.querySelector('.btn-text').textContent = 'Enviando…';
      const req = requests[selected];
      const finish = () => {
        sendBtn.disabled = false;
        sendBtn.querySelector('.btn-text').textContent = 'Enviar';
        status.classList.remove('is-pulse');
        void status.offsetWidth;
        status.classList.add('is-pulse');
      };
      if (Scene.send) Scene.send(req).then(finish);
      else finish();
    });

    select(0);
    textCol.append(list);
    visualCol.append(term, response);
    return () => {
      sendBtn.disabled = false;
      sendBtn.querySelector('.btn-text').textContent = 'Enviar';
    };
  }

  // ---------------------------------------------------------- construcción de diapositivas
  const stage = document.getElementById('stage');
  const slideEls = [];
  const resetters = new Map();

  function eyebrow(slide) {
    return el('p', { class: 'eyebrow reveal' },
      el('span', { class: 'eyebrow-step', text: `Paso ${pad(slide.step)}` }),
      el('span', { class: 'eyebrow-sep', text: '/' }),
      el('span', { text: slide.layer }));
  }

  function partTrack(part) {
    const track = el('span', { class: 'part-track', 'aria-hidden': 'true' });
    for (let i = 1; i <= part.of; i++) track.append(el('i', { class: i === part.n ? 'is-on' : i < part.n ? 'is-done' : '' }));
    return el('p', { class: 'part reveal' }, track, el('span', {}, el('strong', { text: `Parte ${part.n} de ${part.of}` }), ` · ${part.label}`));
  }

  function buildSlide(slide, index) {
    const kind = slide.kind || 'step';
    const section = el('section', {
      class: `slide slide--${kind}`,
      id: slide.id,
      'aria-roledescription': 'diapositiva',
      'aria-label': slide.step != null ? `Paso ${slide.step}: ${slide.title}` : slide.title,
      hidden: true,
      dataset: { index: String(index) },
    });
    const textCol = el('div', { class: 'col-text' });
    const visualCol = el('div', { class: 'col-visual' });

    if (kind === 'cover') {
      textCol.append(
        el('p', { class: 'cover-kicker reveal', text: slide.kicker }),
        el('h1', { class: 'cover-title reveal' }, 'Persona ', el('span', { class: 'cover-title-mono', text: 'API' })),
        slide.lead.map((p) => el('p', { class: 'lead lead--cover reveal', html: p })),
        el('ul', { class: 'cover-meta reveal', 'aria-label': 'Resumen del taller' }, slide.meta.map((m) => el('li', { class: 'meta-chip', text: m }))),
        el('div', { class: 'cover-actions reveal' },
          el('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: () => go(1) }, 'Comenzar', el('span', { class: 'btn-icon', html: ICON.right })),
          el('span', { class: 'hint' }, 'o usa ', el('kbd', { text: '←' }), ' ', el('kbd', { text: '→' }), ' en el teclado')));
      visualCol.append(renderBitHome('bit-home--cover'), renderEditor(slide.visual.tabs, slide.visual.caption));
    } else {
      textCol.append(eyebrow(slide), el('h2', { class: 'slide-title reveal', text: slide.title }));
      if (slide.part) textCol.append(partTrack(slide.part));
      if (slide.file) textCol.append(el('p', { class: 'file-chip reveal' }, el('span', { class: 'btn-icon', html: ICON.file }), slide.file));
      (slide.lead || []).forEach((p) => textCol.append(el('p', { class: 'lead reveal', html: p })));
      if (slide.table) textCol.append(renderTable(slide.table));
      if (slide.checklist) textCol.append(renderChecklist(slide.checklist));
      if (slide.list) textCol.append(el('ul', { class: 'bullets reveal' }, slide.list.map((li) => el('li', { html: li }))));
      if (slide.ordered) textCol.append(el('ol', { class: 'challenges reveal' }, slide.ordered.map((li) => el('li', {}, el('span', { html: li })))));
      if (slide.endpoints) textCol.append(renderEndpoints(slide.endpoints));
      (slide.commands || []).forEach((c) => textCol.append(renderTerminal(c.code, { label: c.label })));
      if (slide.leftVisual === 'architecture') textCol.append(renderArchitecture());

      const v = slide.visual || {};
      if (v.type === 'editor') visualCol.append(renderEditor(v.tabs, v.caption));
      else if (v.type === 'architecture') visualCol.append(renderArchitecture());
      else if (v.type === 'terminal') visualCol.append(v.commands.map((c) => renderTerminal(c.code, { label: c.label })));
      else if (v.type === 'explorer') visualCol.append(renderExplorer(v));
      else if (v.type === 'packages') visualCol.append(renderPackages(v.rows));
      else if (v.type === 'output') visualCol.append(renderOutput(v));
      else if (v.type === 'collection') visualCol.append(renderCollection(v));
      else if (v.type === 'tester') resetters.set(index, renderTester(v, textCol, visualCol));
      else if (v.type === 'celebrate') visualCol.append(renderBitHome('bit-home--final', 'persona-api · 26 pasos completados'));
    }

    section.append(el('div', { class: 'slide-grid' }, textCol, visualCol));
    section.querySelectorAll('.reveal').forEach((node, i) => node.style.setProperty('--i', String(Math.min(i, 10))));
    return section;
  }

  function buildPipeline() {
    const pipeline = document.getElementById('pipeline');
    const node = (n, side) => el('div', { class: `pipe-node${side ? ' pipe-node--side' : ''}`, dataset: { node: n.id }, title: n.hint }, n.label);
    pipeline.append(
      el('div', { class: 'pipe-group' }, PIPE.main.map((n) => node(n, false))),
      el('span', { class: 'pipe-divider', 'aria-hidden': 'true' }),
      el('div', { class: 'pipe-group' }, PIPE.side.map((n) => node(n, true))));
  }

  function buildIndex() {
    const body = document.getElementById('index-body');
    PHASES.forEach((phase) => {
      const items = SLIDES.map((s, i) => ({ s, i })).filter(({ s }) => s.phase === phase.id);
      if (!items.length) return;
      body.append(el('section', { class: 'index-phase' },
        el('h3', { class: 'index-phase-title', text: phase.label }),
        el('ol', { class: 'index-list' }, items.map(({ s, i }) => el('li', {},
          el('button', { class: `index-item${s.part && s.part.n > 1 ? ' is-sub' : ''}`, type: 'button', dataset: { go: String(i) } },
            el('span', { class: 'index-num', text: s.step != null ? pad(s.step) : '··' }),
            el('span', { class: 'index-title', text: s.part ? `${s.title}: ${s.part.label}` : s.title }),
            s.part ? el('span', { class: 'index-part', text: `${s.part.n}/${s.part.of}` }) : null))))));
    });
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-go]');
      if (!btn) return;
      closeIndex();
      go(Number(btn.dataset.go));
    });
  }

  // ---------------------------------------------------------- navegación
  const $ = (id) => document.getElementById(id);
  const narrator = $('narrator');
  const bubble = $('bubble');
  let current = -1;

  function crumbsFor(slide) {
    const crumbs = $('crumbs');
    crumbs.textContent = '';
    const parts = slide.file ? slide.file.split('/') : slide.step != null ? [slide.layer] : [];
    parts.forEach((p, i) => crumbs.append(el('span', { class: 'crumb-sep', text: '/' }), i === parts.length - 1 ? el('b', { text: p }) : el('span', { text: p })));
  }

  function go(index, { initial = false } = {}) {
    index = Math.max(0, Math.min(SLIDES.length - 1, index));
    if (index === current) return;
    const dir = index > current ? 1 : -1;
    const prev = slideEls[current];
    if (prev) {
      prev.hidden = true;
      prev.classList.remove('is-active', 'is-entering');
    }
    if (resetters.has(current)) resetters.get(current)();
    const slide = SLIDES[index];
    const section = slideEls[index];
    current = index;

    section.hidden = false;
    section.classList.add('is-active');
    section.style.setProperty('--dir', String(dir));
    section.classList.remove('is-entering');
    if (!initial) {
      void section.offsetWidth;
      section.classList.add('is-entering');
    }
    stage.scrollTop = 0;
    section.querySelectorAll('.col-text').forEach((c) => { c.scrollTop = 0; });
    revealFocus(section);

    // Barra superior, progreso y navegación
    crumbsFor(slide);
    $('counter').textContent = `${slide.step != null ? `Paso ${pad(slide.step)}` : 'Portada'} · ${index + 1}/${SLIDES.length}`;
    $('progress-bar').style.width = `${(index / (SLIDES.length - 1)) * 100}%`;
    $('btn-prev').disabled = index === 0;
    $('btn-next').disabled = index === SLIDES.length - 1;
    document.querySelectorAll('.index-item').forEach((b) => {
      if (Number(b.dataset.go) === index) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });

    // Nodos iluminados (también sirve de respaldo sin WebGL)
    const lit = new Set((slide.flow && slide.flow.lit) || []);
    document.querySelectorAll('#pipeline [data-node]').forEach((n) => n.classList.toggle('is-lit', lit.has(n.dataset.node)));

    // Bit y su globo de diálogo
    const ownSlot = section.querySelector('[data-bit-slot]');
    narrator.classList.toggle('is-bit-away', !!ownSlot);
    $('bubble-title').textContent = (slide.bubble && slide.bubble.title) || 'Punto clave';
    $('bubble-text').textContent = (slide.bubble && slide.bubble.text) || '';
    bubble.classList.remove('is-pop');
    void bubble.offsetWidth;
    bubble.classList.add('is-pop');

    if (Scene.ready) {
      Scene.setSlide({
        slideEl: section,
        slot: ownSlot || $('bit-slot'),
        flow: slide.flow,
        mood: slide.mood,
        ripple: !initial,
      });
      const words = ((slide.bubble && slide.bubble.text) || '').split(/\s+/).length;
      Scene.talk(Math.min(5200, 600 + words * 150));
    }

    try {
      history.replaceState(null, '', `#${slide.id}`);
    } catch (err) {
      // Algunos visores no permiten cambiar la URL; la navegación sigue funcionando.
    }
  }

  const next = () => go(current + 1);
  const prev = () => go(current - 1);

  // ---------------------------------------------------------- índice
  const indexEl = $('index');
  function openIndex() {
    indexEl.hidden = false;
    const cur = indexEl.querySelector('[aria-current="step"]') || indexEl.querySelector('.index-item');
    if (cur) {
      cur.scrollIntoView({ block: 'center' });
      cur.focus();
    }
  }
  function closeIndex() {
    if (indexEl.hidden) return;
    indexEl.hidden = true;
    $('btn-index').focus();
  }

  // ---------------------------------------------------------- tema
  function effectiveTheme() {
    const t = document.documentElement.dataset.theme;
    if (t === 'dark' || t === 'light') return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function paintThemeButton() {
    const dark = effectiveTheme() === 'dark';
    const btn = $('btn-theme');
    btn.innerHTML = `<span class="btn-icon">${dark ? ICON.sun : ICON.moon}</span><span class="btn-label">${dark ? 'Claro' : 'Oscuro'}</span>`;
    btn.setAttribute('aria-label', dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  }
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
  } catch (err) {
    // Sin almacenamiento disponible: se usa el tema del sistema.
  }

  // ---------------------------------------------------------- arranque
  buildPipeline();
  SLIDES.forEach((s, i) => {
    const section = buildSlide(s, i);
    slideEls.push(section);
    stage.append(section);
  });
  buildIndex();

  $('icon-prev').innerHTML = ICON.left;
  $('icon-next').innerHTML = ICON.right;
  $('icon-index').innerHTML = ICON.list;
  $('icon-close').innerHTML = ICON.close;
  paintThemeButton();

  const ok = Scene.init ? Scene.init({
    back: $('scene-back'),
    front: $('scene-front'),
    stage,
    pipeline: $('pipeline'),
  }) : false;
  if (!ok) document.documentElement.classList.add('no-webgl');

  $('btn-prev').addEventListener('click', prev);
  $('btn-next').addEventListener('click', next);
  $('btn-index').addEventListener('click', openIndex);
  $('btn-close-index').addEventListener('click', closeIndex);
  indexEl.addEventListener('click', (e) => { if (e.target === indexEl) closeIndex(); });
  $('bit-hit').addEventListener('click', () => Scene.poke && Scene.poke());
  $('btn-theme').addEventListener('click', () => {
    const nextTheme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    try { localStorage.setItem(THEME_KEY, nextTheme); } catch (err) { /* sin almacenamiento */ }
    paintThemeButton();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeButton);
  new MutationObserver(paintThemeButton).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  document.addEventListener('keydown', (e) => {
    if (!indexEl.hidden) {
      if (e.key === 'Escape') closeIndex();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    const inScrollable = target.closest && target.closest('.editor-body, .terminal-body, .tree-wrap, [role="tablist"]');
    const onButton = target.closest && target.closest('button');
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
        if (inScrollable && e.key === 'ArrowRight') return;
        e.preventDefault();
        next();
        break;
      case 'ArrowLeft':
      case 'PageUp':
        if (inScrollable && e.key === 'ArrowLeft') return;
        e.preventDefault();
        prev();
        break;
      case ' ':
        if (onButton || inScrollable) return;
        e.preventDefault();
        if (e.shiftKey) prev();
        else next();
        break;
      case 'Home':
        if (inScrollable) return;
        e.preventDefault();
        go(0);
        break;
      case 'End':
        if (inScrollable) return;
        e.preventDefault();
        go(SLIDES.length - 1);
        break;
      case 'i':
      case 'I':
        e.preventDefault();
        openIndex();
        break;
      default:
    }
  });

  // Gestos de deslizamiento en pantallas táctiles
  let touchStart = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.target.closest('.editor-body, .terminal-body, .tree-wrap, .table-wrap')) {
      touchStart = null;
      return;
    }
    touchStart = { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener('pointerup', (e) => {
    if (!touchStart) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) next();
      else prev();
    }
  });

  const fromHash = SLIDES.findIndex((s) => `#${s.id}` === window.location.hash);
  go(fromHash >= 0 ? fromHash : 0, { initial: true });
})();
