(() => {
  // T06.06: Terminal-State-Emulator mit Background-Color + Cursor-Position
  const ANSI_256 = [
    [0,0,0],[128,0,0],[0,128,0],[128,128,0],[0,0,128],[128,0,128],[0,128,128],[192,192,192],
    [128,128,128],[255,0,0],[0,255,0],[255,255,0],[0,0,255],[255,0,255],[0,255,255],[255,255,255]
  ];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++)
    ANSI_256.push([r ? r*40+55 : 0, g ? g*40+55 : 0, b ? b*40+55 : 0]);
  for (let i = 0; i < 24; i++) { const v = 8+i*10; ANSI_256.push([v,v,v]); }

  const COLS = 120;
  const ROWS = 32;

  function makeBuffer() {
    return Array.from({length: ROWS}, () =>
      Array.from({length: COLS}, () => ({ch: ' ', fg: null, bg: null, bold: false}))
    );
  }

  function cloneBuffer(buf) {
    return buf.map(row => row.map(cell => ({...cell})));
  }

  // T06.06: ANSI escape sequence processor – updates a terminal buffer in-place
  function applySequences(buf, input, state) {
    let {cx, cy, fg, bg, bold, altBuf, savedBuf} = state;
    let i = 0;
    const n = input.length;

    const put = (ch) => {
      if (cy >= 0 && cy < ROWS && cx >= 0 && cx < COLS) {
        buf[cy][cx] = {ch, fg: fg ? [...fg] : null, bg: bg ? [...bg] : null, bold};
      }
      cx++;
      if (cx >= COLS) { cx = 0; cy++; }
      if (cy >= ROWS) cy = ROWS - 1;
    };

    while (i < n) {
      if (input[i] !== '\x1b') {
        if (input[i] === '\r') { cx = 0; i++; continue; }
        if (input[i] === '\n') { cy = Math.min(ROWS - 1, cy + 1); i++; continue; }
        if (input[i] === '\b') { cx = Math.max(0, cx - 1); i++; continue; }
        put(input[i]); i++; continue;
      }
      i++;
      if (i >= n) break;

      if (input[i] === '[') {
        i++;
        let seq = '';
        while (i < n && !/[@-~]/.test(input[i])) { seq += input[i]; i++; }
        const cmd = input[i] ?? ''; i++;
        const params = seq.split(';').map(s => s === '' ? 0 : parseInt(s, 10));
        const p = (idx, def = 0) => (params[idx] ?? def) || def;

        if (cmd === 'H' || cmd === 'f') {
          // cursor position
          cy = Math.max(0, Math.min(ROWS - 1, (p(0, 1) - 1)));
          cx = Math.max(0, Math.min(COLS - 1, (p(1, 1) - 1)));
        } else if (cmd === 'A') { cy = Math.max(0, cy - p(0, 1)); }
        else if (cmd === 'B') { cy = Math.min(ROWS - 1, cy + p(0, 1)); }
        else if (cmd === 'C') { cx = Math.min(COLS - 1, cx + p(0, 1)); }
        else if (cmd === 'D') { cx = Math.max(0, cx - p(0, 1)); }
        else if (cmd === 'G') { cx = Math.max(0, Math.min(COLS - 1, p(0, 1) - 1)); }
        else if (cmd === 'd') { cy = Math.max(0, Math.min(ROWS - 1, p(0, 1) - 1)); }
        else if (cmd === 'J') {
          const mode = p(0, 0);
          if (mode === 2 || mode === 3) {
            // erase screen
            for (let r = 0; r < ROWS; r++)
              for (let c = 0; c < COLS; c++) buf[r][c] = {ch: ' ', fg: null, bg: null, bold: false};
            cx = 0; cy = 0;
          } else if (mode === 1) {
            for (let r = 0; r < cy; r++) for (let c = 0; c < COLS; c++) buf[r][c] = {ch: ' ', fg: null, bg: null, bold: false};
            for (let c = 0; c <= cx; c++) buf[cy][c] = {ch: ' ', fg: null, bg: null, bold: false};
          } else {
            for (let c = cx; c < COLS; c++) buf[cy][c] = {ch: ' ', fg: null, bg: null, bold: false};
            for (let r = cy + 1; r < ROWS; r++) for (let c = 0; c < COLS; c++) buf[r][c] = {ch: ' ', fg: null, bg: null, bold: false};
          }
        } else if (cmd === 'K') {
          const mode = p(0, 0);
          if (mode === 0) { for (let c = cx; c < COLS; c++) buf[cy][c] = {ch: ' ', fg: null, bg: null, bold: false}; }
          else if (mode === 1) { for (let c = 0; c <= cx; c++) buf[cy][c] = {ch: ' ', fg: null, bg: null, bold: false}; }
          else { for (let c = 0; c < COLS; c++) buf[cy][c] = {ch: ' ', fg: null, bg: null, bold: false}; }
        } else if (cmd === 'm') {
          // SGR – color handling
          let j = 0;
          if (params.length === 0 || (params.length === 1 && params[0] === 0)) { fg = null; bg = null; bold = false; }
          while (j < params.length) {
            const c = params[j];
            if (c === 0) { fg = null; bg = null; bold = false; }
            else if (c === 1) { bold = true; }
            else if (c === 22) { bold = false; }
            else if (c === 38 && params[j+1] === 2) { fg = [params[j+2]??0, params[j+3]??0, params[j+4]??0]; j += 4; }
            else if (c === 38 && params[j+1] === 5) { fg = [...(ANSI_256[params[j+2]??14] ?? ANSI_256[14])]; j += 2; }
            else if (c === 48 && params[j+1] === 2) { bg = [params[j+2]??0, params[j+3]??0, params[j+4]??0]; j += 4; }
            else if (c === 48 && params[j+1] === 5) { bg = [...(ANSI_256[params[j+2]??0] ?? ANSI_256[0])]; j += 2; }
            else if (c >= 30 && c <= 37) { fg = [...(ANSI_256[c - 30])]; }
            else if (c >= 90 && c <= 97) { fg = [...(ANSI_256[c - 90 + 8])]; }
            else if (c >= 40 && c <= 47) { bg = [...(ANSI_256[c - 40])]; }
            else if (c >= 100 && c <= 107) { bg = [...(ANSI_256[c - 100 + 8])]; }
            else if (c === 39) { fg = null; }
            else if (c === 49) { bg = null; }
            j++;
          }
        } else if (cmd === 'h' && seq.includes('?1049')) {
          // T06.06: enter alternate buffer – snapshot main
          savedBuf = cloneBuffer(buf);
          for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) buf[r][c] = {ch: ' ', fg: null, bg: null, bold: false};
          cx = 0; cy = 0;
        } else if (cmd === 'l' && seq.includes('?1049')) {
          // leave alternate buffer – restore main
          if (savedBuf) { for (let r = 0; r < ROWS; r++) buf[r] = savedBuf[r]; savedBuf = null; }
        }
      } else {
        i++; // skip unknown escape
      }
    }
    return {cx, cy, fg, bg, bold, altBuf, savedBuf};
  }

  // T06.06: Render terminal buffer to HTML (performance: < 5ms for 120×32)
  function bufferToHtml(buf) {
    const t0 = performance.now();
    const parts = [];
    for (let r = 0; r < ROWS; r++) {
      const row = buf[r];
      let prev = null;
      for (let c = 0; c < COLS; c++) {
        const cell = row[c];
        const same = prev && arrEq(cell.fg, prev.fg) && arrEq(cell.bg, prev.bg) && cell.bold === prev.bold;
        if (!same) {
          if (prev !== null) parts.push('</span>');
          let style = '';
          if (cell.fg) style += `color:rgb(${cell.fg});`;
          if (cell.bg) style += `background:rgb(${cell.bg});`;
          if (cell.bold) style += 'font-weight:bold;';
          parts.push(style ? `<span style="${style}">` : '<span>');
          prev = cell;
        }
        parts.push(escHtml(cell.ch));
      }
      if (prev !== null) parts.push('</span>');
      if (r < ROWS - 1) parts.push('\n');
    }
    const elapsed = performance.now() - t0;
    if (elapsed > 10) console.debug(`bufferToHtml: ${elapsed.toFixed(1)}ms`);
    return parts.join('');
  }

  function arrEq(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  function escHtml(ch) {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    return ch;
  }

  // legacy simple renderer for asciinema-player path
  function ansiToHtml(input) {
    let html = '', open = false, pos = 0;
    const regex = /\x1b\[([0-9;]*)m/g;
    let match;
    while ((match = regex.exec(input)) !== null) {
      html += escHtml2(input.slice(pos, match.index)); pos = regex.lastIndex;
      const codes = (match[1]||'0').split(';').filter(Boolean).map(Number);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code === 0) { if (open) html += '</span>'; open = false; }
        else if (code === 38 && codes[i+1] === 2) {
          const [r,g,b] = [codes[i+2]??112, codes[i+3]??225, codes[i+4]??200];
          if (open) html += '</span>';
          html += `<span style="color:rgb(${r},${g},${b})">`;
          open = true; i += 4;
        } else if (code === 38 && codes[i+1] === 5) {
          const [r,g,b] = ANSI_256[codes[i+2]??14] || ANSI_256[14];
          if (open) html += '</span>';
          html += `<span style="color:rgb(${r},${g},${b})">`;
          open = true; i += 2;
        }
      }
    }
    html += escHtml2(input.slice(pos));
    if (open) html += '</span>';
    return html;
  }

  function escHtml2(t) {
    return t.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  }

  async function loadCast(url) {
    const res = await fetch(url, {cache: 'force-cache'});
    if (!res.ok) throw new Error(`cast fetch failed: ${res.status}`);
    const text = await res.text();
    return text.trim().split(/\n+/).slice(1)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(e => e && e[1] === 'o' && typeof e[2] === 'string')
      .map(e => ({time: Number(e[0])||0, raw: String(e[2])}));
  }

  async function loadChapters(url) {
    try {
      const res = await fetch(url, {cache: 'force-cache'});
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data.chapters) ? data.chapters : null;
    } catch { return null; }
  }

  // T06.01: render chapter timeline
  function buildTimeline(chapters, container, onSeek) {
    container.innerHTML = '';
    container.setAttribute('role', 'toolbar');
    chapters.forEach((ch, idx) => {
      const btn = document.createElement('button');
      btn.className = 'chapter-btn';
      btn.textContent = ch.title.slice(0, 20);
      btn.title = ch.description || ch.title;
      btn.dataset.chapterIdx = idx;
      btn.addEventListener('click', () => {
        onSeek(ch.t, idx);
        // active state
        container.querySelectorAll('.chapter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      container.appendChild(btn);
    });
  }

  function updateActiveChapter(timelineEl, chapters, currentTime) {
    if (!chapters || !timelineEl) return;
    let activeIdx = 0;
    for (let i = 0; i < chapters.length; i++) {
      if (currentTime >= chapters[i].t) activeIdx = i;
    }
    timelineEl.querySelectorAll('.chapter-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === activeIdx);
    });
    return activeIdx;
  }

  // T06.02: update caption with fade
  function updateCaption(captionEl, chapter) {
    if (!captionEl || !chapter) return;
    const strong = captionEl.querySelector('strong');
    const span = captionEl.querySelector('span');
    captionEl.style.opacity = '0';
    setTimeout(() => {
      if (strong) strong.textContent = chapter.title;
      if (span) span.textContent = chapter.description || '';
      captionEl.style.transition = 'opacity 150ms ease';
      captionEl.style.opacity = '1';
    }, 150);
  }

  async function mountTerminalCastPlayer(node) {
    const output = node.querySelector('[data-terminal-output]');
    const status = node.querySelector('[data-terminal-status]');
    const captionEl = node.querySelector('.terminal-caption');
    const url = node.dataset.castUrl || './assets/operator_tui_splash.cast';
    const chaptersUrl = url.replace(/\.cast$/, '.chapters.json');

    // T06.03: Fullscreen button (mobile ≤ 920px)
    const termBar = node.querySelector('.terminal-bar');
    if (termBar && window.innerWidth <= 920 && document.fullscreenEnabled) {
      const fsBtn = document.createElement('button');
      fsBtn.className = 'fullscreen-btn';
      fsBtn.setAttribute('aria-label', 'Vollbild');
      fsBtn.innerHTML = '&#x26F6;';
      fsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          node.requestFullscreen && node.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen && document.exitFullscreen();
        }
      });
      termBar.appendChild(fsBtn);
    }

    // T06.01: chapter timeline
    let timelineEl = node.querySelector('.chapter-timeline');
    if (!timelineEl) {
      timelineEl = document.createElement('div');
      timelineEl.className = 'chapter-timeline';
      const stage = node.querySelector('.terminal-stage');
      if (stage) stage.insertAdjacentElement('afterend', timelineEl);
    }

    // T06.04: Intersection Observer – lazy init
    const doInit = () => _initPlayer(node, output, status, captionEl, timelineEl, url, chaptersUrl);
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver(entries => {
        if (entries.some(e => e.intersectionRatio >= 0.3)) {
          obs.disconnect();
          doInit();
        }
      }, {threshold: 0.3});
      obs.observe(node);
    } else {
      doInit();
    }

    // T06.05: keyboard shortcuts (focused terminal card)
    node.setAttribute('tabindex', '0');
    node.addEventListener('keydown', e => _handleKey(e, node));
  }

  // player state
  const _playerState = new WeakMap();

  async function _initPlayer(node, output, status, captionEl, timelineEl, url, chaptersUrl) {
    try {
      if (status) status.textContent = 'loading cast';

      // T06.01: load chapters in parallel
      const [, chapters] = await Promise.all([
        Promise.resolve(),
        loadChapters(chaptersUrl),
      ]);

      if (chapters && timelineEl) {
        buildTimeline(chapters, timelineEl, (t, idx) => {
          const ps = _playerState.get(node);
          if (ps) {
            // seek: find frame index closest to t
            const frames = ps.frames;
            let fi = 0;
            for (let i = 0; i < frames.length; i++) {
              if (frames[i].time >= t) { fi = i; break; }
              fi = i;
            }
            ps.index = fi;
            if (captionEl && chapters[idx]) updateCaption(captionEl, chapters[idx]);
          }
          if (ps && ps.asciinemaPlayer) {
            try { ps.asciinemaPlayer.getCurrentTime && ps.asciinemaPlayer.seek(t); } catch {}
          }
        });
      }

      // try asciinema player first
      if (window.AsciinemaPlayer && typeof window.AsciinemaPlayer.create === 'function') {
        output.textContent = '';
        output.classList.add('asciinema-host');
        const ap = window.AsciinemaPlayer.create(url, output, {
          autoPlay: true, loop: true, preload: true,
          controls: false, fit: 'width', speed: 1,
          terminalFontSize: '10px', terminalLineHeight: 1.05,
        });
        _playerState.set(node, {frames: [], index: 0, asciinemaPlayer: ap});
        if (status) status.textContent = 'live cast · asciinema player';

        // chapter polling for asciinema player
        if (chapters && captionEl) {
          let lastCh = -1;
          setInterval(() => {
            try {
              const t = ap.getCurrentTime ? ap.getCurrentTime() : 0;
              const activeIdx = updateActiveChapter(timelineEl, chapters, t);
              if (activeIdx !== lastCh) {
                lastCh = activeIdx;
                updateCaption(captionEl, chapters[activeIdx]);
              }
            } catch {}
          }, 500);
        }
        return;
      }

      // T06.06: fallback player with terminal state emulator
      const rawFrames = await loadCast(url);
      if (!rawFrames.length) throw new Error('no frames');
      if (status) status.textContent = `${rawFrames.length} frames · emulator`;

      // pre-process: build per-frame buffers lazily (render on demand)
      const buf = makeBuffer();
      let termState = {cx: 0, cy: 0, fg: null, bg: null, bold: false, altBuf: false, savedBuf: null};

      // Build renderable frames: apply all sequences up to each frame index
      const frames = rawFrames.map(f => ({time: f.time, html: null, raw: f.raw}));
      // pre-render first few frames eagerly, rest lazily
      const preRender = Math.min(5, frames.length);
      for (let i = 0; i < preRender; i++) {
        termState = applySequences(buf, frames[i].raw, termState);
        frames[i].html = bufferToHtml(cloneBuffer(buf));
      }
      // store buf state after pre-render for lazy continuation
      let lazyBuf = cloneBuffer(buf);
      let lazyState = {...termState};
      let lazyIdx = preRender;

      _playerState.set(node, {frames, index: 0, lazyBuf, lazyState, lazyIdx});

      let index = 0;
      let lastChapterIdx = -1;

      const render = () => {
        const ps = _playerState.get(node);
        if (!ps) return;
        index = ps.index;
        const frame = frames[index];

        // lazy render if needed
        if (frame.html === null) {
          // render from lazyIdx up to index
          while (ps.lazyIdx <= index) {
            ps.lazyState = applySequences(ps.lazyBuf, frames[ps.lazyIdx].raw, ps.lazyState);
            frames[ps.lazyIdx].html = bufferToHtml(cloneBuffer(ps.lazyBuf));
            ps.lazyIdx++;
          }
        }

        if (frame.html !== null) output.innerHTML = frame.html;

        // T06.02: update caption + T06.01: update active chapter
        if (chapters) {
          const activeIdx = updateActiveChapter(timelineEl, chapters, frame.time);
          if (activeIdx !== lastChapterIdx) {
            lastChapterIdx = activeIdx;
            updateCaption(captionEl, chapters[activeIdx]);
          }
        }

        const nextIdx = (index + 1) % frames.length;
        ps.index = nextIdx;
        const cur = frames[index];
        const nxt = frames[nextIdx];
        const delay = Math.max(24, Math.min(140, ((nxt.time - cur.time) || 0.0417) * 1000));
        if (!ps.paused) window.setTimeout(render, delay);
      };

      render();
    } catch (err) {
      if (status) status.textContent = 'fallback animation';
      output.textContent = [
        '        /\\        ',
        '       /  \\       ',
        '      / /\\ \\      ',
        '     / ____ \\     ',
        '    /_/    \\_\\    ',
        '       ~ ananta ~   ',
        '  agent control hub ',
      ].join('\n');
      console.warn('Ananta terminal cast player fallback:', err);
    }
  }

  // T06.05: keyboard shortcuts
  function _handleKey(e, node) {
    const ps = _playerState.get(node);
    if (!ps || ps.asciinemaPlayer) return;  // asciinema player has its own
    if (e.key === ' ') {
      e.preventDefault();
      ps.paused = !ps.paused;
      if (!ps.paused) {
        const frames = ps.frames;
        const render = () => {
          if (!ps || ps.paused) return;
          const frame = frames[ps.index];
          if (frame && frame.html !== null) {
            const output = node.querySelector('[data-terminal-output]');
            if (output) output.innerHTML = frame.html;
          }
          const nextIdx = (ps.index + 1) % frames.length;
          const cur = frames[ps.index];
          const nxt = frames[nextIdx];
          ps.index = nextIdx;
          const delay = Math.max(24, Math.min(140, ((nxt.time - cur.time) || 0.0417) * 1000));
          window.setTimeout(render, delay);
        };
        render();
      }
      const status = node.querySelector('[data-terminal-status]');
      if (status) status.textContent = ps.paused ? 'paused' : 'playing';
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const frames = ps.frames;
      const target = (frames[ps.index]?.time || 0) + 5;
      let fi = ps.index;
      for (let i = ps.index; i < frames.length; i++) { if (frames[i].time >= target) { fi = i; break; } fi = i; }
      ps.index = fi;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const frames = ps.frames;
      const target = Math.max(0, (frames[ps.index]?.time || 0) - 5);
      let fi = 0;
      for (let i = 0; i < frames.length; i++) { if (frames[i].time >= target) break; fi = i; }
      ps.index = fi;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-terminal-cast]').forEach(mountTerminalCastPlayer);
  });
})();
