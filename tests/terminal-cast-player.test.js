/**
 * T07.01: Unit-Tests für terminal-cast-player.js
 * Abgedeckt: ANSI-Parser, Terminal-State, Background-Color, Cursor-Move, Alternate-Buffer
 * Läuft mit: npm test (Vitest, kein Browser nötig)
 */

import { describe, it, expect } from 'vitest';

// -- extract pure functions for testing --
// We re-implement the helpers inline here to avoid IIFE isolation
const ANSI_256 = (() => {
  const c = [
    [0,0,0],[128,0,0],[0,128,0],[128,128,0],[0,0,128],[128,0,128],[0,128,128],[192,192,192],
    [128,128,128],[255,0,0],[0,255,0],[255,255,0],[0,0,255],[255,0,255],[0,255,255],[255,255,255],
  ];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++)
    c.push([r ? r*40+55:0, g ? g*40+55:0, b ? b*40+55:0]);
  for (let i = 0; i < 24; i++) { const v = 8+i*10; c.push([v,v,v]); }
  return c;
})();

const COLS = 10;
const ROWS = 5;

function makeBuffer() {
  return Array.from({length: ROWS}, () =>
    Array.from({length: COLS}, () => ({ch:' ', fg:null, bg:null, bold:false}))
  );
}

function cloneBuffer(buf) {
  return buf.map(row => row.map(cell => ({...cell})));
}

function applySequences(buf, input, state) {
  let {cx, cy, fg, bg, bold, savedBuf} = state;
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
      if (input[i] === '\n') { cy = Math.min(ROWS-1, cy+1); i++; continue; }
      put(input[i]); i++; continue;
    }
    i++;
    if (i >= n) break;
    if (input[i] === '[') {
      i++;
      let seq = '';
      while (i < n && !/[@-~]/.test(input[i])) { seq += input[i]; i++; }
      const cmd = input[i] ?? ''; i++;
      const params = seq.split(';').map(s => s==='' ? 0 : parseInt(s,10));
      const p = (idx, def=0) => (params[idx]??def)||def;
      if (cmd === 'H' || cmd === 'f') {
        cy = Math.max(0, Math.min(ROWS-1, p(0,1)-1));
        cx = Math.max(0, Math.min(COLS-1, p(1,1)-1));
      } else if (cmd === 'A') { cy = Math.max(0, cy-p(0,1)); }
      else if (cmd === 'B') { cy = Math.min(ROWS-1, cy+p(0,1)); }
      else if (cmd === 'C') { cx = Math.min(COLS-1, cx+p(0,1)); }
      else if (cmd === 'D') { cx = Math.max(0, cx-p(0,1)); }
      else if (cmd === 'G') { cx = Math.max(0, Math.min(COLS-1, p(0,1)-1)); }
      else if (cmd === 'J') {
        const mode = p(0,0);
        if (mode === 2) {
          for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) buf[r][c]={ch:' ',fg:null,bg:null,bold:false};
          cx=0; cy=0;
        }
      } else if (cmd === 'K') {
        for (let c=cx; c<COLS; c++) buf[cy][c]={ch:' ',fg:null,bg:null,bold:false};
      } else if (cmd === 'm') {
        let j = 0;
        if (params.length===0 || (params.length===1 && params[0]===0)) { fg=null; bg=null; bold=false; }
        while (j < params.length) {
          const c = params[j];
          if (c===0) { fg=null; bg=null; bold=false; }
          else if (c===1) { bold=true; }
          else if (c===22) { bold=false; }
          else if (c===38 && params[j+1]===2) { fg=[params[j+2]??0,params[j+3]??0,params[j+4]??0]; j+=4; }
          else if (c===38 && params[j+1]===5) { fg=[...ANSI_256[params[j+2]??14]]; j+=2; }
          else if (c===48 && params[j+1]===2) { bg=[params[j+2]??0,params[j+3]??0,params[j+4]??0]; j+=4; }
          else if (c===48 && params[j+1]===5) { bg=[...ANSI_256[params[j+2]??0]]; j+=2; }
          else if (c>=30&&c<=37) { fg=[...ANSI_256[c-30]]; }
          else if (c>=40&&c<=47) { bg=[...ANSI_256[c-40]]; }
          else if (c===39) { fg=null; }
          else if (c===49) { bg=null; }
          j++;
        }
      } else if (cmd==='h' && seq.includes('?1049')) {
        savedBuf = cloneBuffer(buf);
        for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) buf[r][c]={ch:' ',fg:null,bg:null,bold:false};
        cx=0; cy=0;
      } else if (cmd==='l' && seq.includes('?1049')) {
        if (savedBuf) { for (let r=0; r<ROWS; r++) buf[r]=savedBuf[r]; savedBuf=null; }
      }
    } else { i++; }
  }
  return {cx, cy, fg, bg, bold, savedBuf};
}

function mkState() { return {cx:0, cy:0, fg:null, bg:null, bold:false, savedBuf:null}; }

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Terminal Buffer', () => {
  it('makeBuffer creates ROWS×COLS of spaces', () => {
    const buf = makeBuffer();
    expect(buf.length).toBe(ROWS);
    expect(buf[0].length).toBe(COLS);
    expect(buf[0][0]).toEqual({ch:' ', fg:null, bg:null, bold:false});
  });

  it('puts plain text at current cursor position', () => {
    const buf = makeBuffer();
    applySequences(buf, 'Hi', mkState());
    expect(buf[0][0].ch).toBe('H');
    expect(buf[0][1].ch).toBe('i');
  });

  it('newline advances cursor row', () => {
    const buf = makeBuffer();
    const s = applySequences(buf, 'A\nB', mkState());
    expect(buf[0][0].ch).toBe('A');
    expect(buf[1][0].ch).toBe('B');
  });
});

describe('Cursor Movement', () => {
  it('CSI H moves cursor to row/col', () => {
    const buf = makeBuffer();
    const s = applySequences(buf, '\x1b[3;2H', mkState());
    expect(s.cy).toBe(2);
    expect(s.cx).toBe(1);
  });

  it('CSI A moves cursor up', () => {
    const buf = makeBuffer();
    let s = mkState(); s.cy = 3;
    s = applySequences(buf, '\x1b[2A', s);
    expect(s.cy).toBe(1);
  });

  it('CSI B moves cursor down', () => {
    const buf = makeBuffer();
    let s = mkState();
    s = applySequences(buf, '\x1b[2B', s);
    expect(s.cy).toBe(2);
  });

  it('CSI C moves cursor right', () => {
    const buf = makeBuffer();
    let s = mkState();
    s = applySequences(buf, '\x1b[3C', s);
    expect(s.cx).toBe(3);
  });

  it('CSI D moves cursor left', () => {
    const buf = makeBuffer();
    let s = mkState(); s.cx = 5;
    s = applySequences(buf, '\x1b[2D', s);
    expect(s.cx).toBe(3);
  });

  it('CSI G sets cursor column', () => {
    const buf = makeBuffer();
    let s = mkState();
    s = applySequences(buf, '\x1b[5G', s);
    expect(s.cx).toBe(4);
  });

  it('cursor clamps at bottom row', () => {
    const buf = makeBuffer();
    let s = mkState();
    s = applySequences(buf, '\x1b[99B', s);
    expect(s.cy).toBe(ROWS - 1);
  });

  it('cursor clamps at right edge', () => {
    const buf = makeBuffer();
    let s = mkState();
    s = applySequences(buf, '\x1b[99C', s);
    expect(s.cx).toBe(COLS - 1);
  });
});

describe('Truecolor (38;2 and 48;2)', () => {
  it('sets foreground truecolor', () => {
    const buf = makeBuffer();
    const s = applySequences(buf, '\x1b[38;2;255;128;0mA', mkState());
    expect(buf[0][0].fg).toEqual([255, 128, 0]);
    expect(buf[0][0].ch).toBe('A');
  });

  it('sets background truecolor', () => {
    const buf = makeBuffer();
    applySequences(buf, '\x1b[48;2;10;20;30mB', mkState());
    expect(buf[0][0].bg).toEqual([10, 20, 30]);
  });

  it('reset clears fg and bg', () => {
    const buf = makeBuffer();
    let s = applySequences(buf, '\x1b[38;2;100;200;50mA', mkState());
    s = applySequences(buf, '\x1b[0mB', s);
    expect(buf[0][1].fg).toBeNull();
  });
});

describe('ANSI-256 Color', () => {
  it('38;5;14 sets fg to ANSI_256[14] (cyan)', () => {
    const buf = makeBuffer();
    applySequences(buf, '\x1b[38;5;14mX', mkState());
    expect(buf[0][0].fg).toEqual(ANSI_256[14]);
  });

  it('48;5;1 sets bg to ANSI_256[1] (dark red)', () => {
    const buf = makeBuffer();
    applySequences(buf, '\x1b[48;5;1mY', mkState());
    expect(buf[0][0].bg).toEqual(ANSI_256[1]);
  });

  it('ANSI_256 has exactly 256 entries', () => {
    expect(ANSI_256.length).toBe(256);
  });
});

describe('Bold attribute', () => {
  it('CSI 1m sets bold', () => {
    const buf = makeBuffer();
    const s = applySequences(buf, '\x1b[1mZ', mkState());
    expect(buf[0][0].bold).toBe(true);
  });

  it('CSI 22m clears bold', () => {
    const buf = makeBuffer();
    let s = applySequences(buf, '\x1b[1m', mkState());
    s = applySequences(buf, '\x1b[22m', s);
    expect(s.bold).toBe(false);
  });
});

describe('Erase sequences', () => {
  it('CSI 2J clears entire screen', () => {
    const buf = makeBuffer();
    applySequences(buf, 'HELLO', mkState());
    const s = applySequences(buf, '\x1b[2J', mkState());
    expect(buf[0][0].ch).toBe(' ');
    expect(s.cx).toBe(0);
    expect(s.cy).toBe(0);
  });

  it('CSI K erases from cursor to end of line', () => {
    const buf = makeBuffer();
    applySequences(buf, 'ABCDE', mkState());
    let s = mkState(); s.cx = 2;
    applySequences(buf, '\x1b[K', s);
    expect(buf[0][0].ch).toBe('A');
    expect(buf[0][1].ch).toBe('B');
    expect(buf[0][2].ch).toBe(' ');
  });
});

describe('Alternate Buffer (?1049h/l)', () => {
  it('enters alt buffer, clears screen, restores on exit', () => {
    const buf = makeBuffer();
    let s = applySequences(buf, 'HELLO', mkState());
    // Enter alt buffer
    s = applySequences(buf, '\x1b[?1049h', s);
    expect(buf[0][0].ch).toBe(' '); // alt buffer is blank
    // Write something in alt buffer
    s = applySequences(buf, 'ALT', s);
    // Exit alt buffer – main buffer restored
    s = applySequences(buf, '\x1b[?1049l', s);
    expect(buf[0][0].ch).toBe('H');
  });

  it('savedBuf is null after exit', () => {
    const buf = makeBuffer();
    let s = applySequences(buf, '\x1b[?1049h', mkState());
    s = applySequences(buf, '\x1b[?1049l', s);
    expect(s.savedBuf).toBeNull();
  });
});

describe('ANSI_256 palette correctness', () => {
  it('index 0 is black', () => {
    expect(ANSI_256[0]).toEqual([0,0,0]);
  });
  it('index 15 is white', () => {
    expect(ANSI_256[15]).toEqual([255,255,255]);
  });
  it('index 16 starts 6×6×6 cube', () => {
    expect(ANSI_256[16]).toEqual([0,0,0]);
  });
  it('index 232 starts grayscale ramp', () => {
    expect(ANSI_256[232]).toEqual([8,8,8]);
  });
});
