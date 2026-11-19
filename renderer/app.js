'use strict';
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const toast = (m) => { const t = h('div', { class: 'toast', text: m }); document.body.append(t); setTimeout(() => t.remove(), 3000); };
const fmtTime = (s) => { s = Math.max(0, Math.round(s || 0)); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); };
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB');

const fps = (r) => { const [a, b] = String(r).split("/").map(Number); return b ? a / b : 0; };
// state
let file = null; // {fid, name, size, probe, check}
let report = null; // {items:[{level,text}], verdict}
let busy = false, lastFix = null;

const app = $('#app');
const toolbar = h('div', { class: 'toolbar' });
const main = h('div', { class: 'main', style: 'flex:1;min-height:0;min-width:0;width:100%;overflow:hidden' });
const stage = h('div', { class: 'stage', style: 'padding:18px;flex:1;min-width:0;overflow:auto;display:block' });
const right = h('div', { class: 'sidebar right', style: 'width:300px' });
const status = h('div', { class: 'status' });
main.append(stage, right); app.append(toolbar, main, status);
const btn = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn, text: label });
toolbar.append(btn('Open file', openFile, 'primary'), h('span', { class: 'sep' }), btn('Check file', () => runCheck()), h('span', { class: 'grow' }));

const FILTERS = [['Media files', ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', 'ts', '3gp', 'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma']], ['All files', ['*']]];
async function openFile() {
  const f = (await window.host.openFiles({ read: false, filters: FILTERS }))[0]; if (!f) return;
  file = { fid: f.id, name: f.name, size: f.size, probe: null }; report = null; lastFix = null;
  render(); await runCheck();
}

// A decode pass with ffmpeg to /dev/null-like sink: we write to a temp file with "-f null" is not allowed (needs {out}); use temp mkv/wav instead.
async function runCheck() {
  if (!file || busy) return; busy = true; report = null; render('Checking the file...');
  const items = [];
  const p = await window.host.probe(file.fid);
  file.probe = p;
  if (!p.json || !p.json.streams || !p.json.streams.length) {
    items.push({ level: 'bad', text: 'The file header cannot be read. It may be badly damaged, cut short, or not a media file.' });
    if (p.err) items.push({ level: 'info', text: p.err.trim().split('\n').slice(-2).join(' ') });
    report = { items, verdict: 'damaged', header: false }; busy = false; render(); return;
  }
  const v = p.json.streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic)), a = p.json.streams.find((s) => s.codec_type === 'audio');
  const dur = parseFloat(p.json.format.duration) || 0;
  items.push({ level: 'ok', text: 'Header is readable: ' + [p.json.format.format_long_name, fmtTime(dur)].join(', ') });
  if (v) items.push({ level: 'ok', text: `Video: ${v.codec_name}, ${v.width}x${v.height}${v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? ', ' + fps(v.avg_frame_rate).toFixed(2) + ' fps' : ''}` });
  else items.push({ level: 'info', text: 'No video stream found' });
  if (a) items.push({ level: 'ok', text: `Audio: ${a.codec_name}, ${a.sample_rate || '?'} Hz, ${a.channels || '?'} channel(s)` });
  else if (v) items.push({ level: 'warn', text: 'No audio stream found' });
  if (!dur) items.push({ level: 'warn', text: 'The length is missing, which often means the file was cut off while recording' });
  // bitrate sanity: size vs duration
  if (dur && file.size) { const kbps = (file.size * 8) / dur / 1000; if (v && kbps < 20) items.push({ level: 'warn', text: 'The file is much smaller than expected for its length, so data may be missing' }); }
  // full decode pass to a temp file to find errors
  let decodeErrors = [];
  try {
    const args = ['-v', 'error', '-i', '{in0}'];
    if (v) args.push('-map', '0:v:0', '-c:v', 'mpeg4', '-q:v', '31', '-r', '5', '-s', '160x90', '-an', '{out}'); else args.push('-vn', '-ac', '1', '-ar', '8000', '-c:a', 'pcm_s16le', '{out}');
    window.host.onProgress((pr) => { if (dur) { const el = $('#chkbar'); if (el) el.style.width = Math.min(99, (pr.t / dur) * 100) + '%'; } });
    const r = await window.host.run({ args, inputs: [file.fid], out: 'temp:' + (v ? 'avi' : 'wav'), duration: dur });
    window.host.removeFile(r.id);
    const log = String(r.log || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (log.length) decodeErrors.push(log.slice(0, 40).join(String.fromCharCode(10)));
  } catch (e) { decodeErrors.push(String(e.message || e).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
  if (decodeErrors.length) { items.push({ level: 'bad', text: 'Problems found while reading the whole file:' }); decodeErrors[0].split('\n').slice(-4).forEach((l) => items.push({ level: 'info', text: l.slice(0, 140) })); }
  else items.push({ level: 'ok', text: 'The whole file decoded without errors' });
  const verdict = items.some((i) => i.level === 'bad') ? 'damaged' : items.some((i) => i.level === 'warn') ? 'suspect' : 'healthy';
  report = { items, verdict, header: true, hasVideo: !!v, hasAudio: !!a, dur }; busy = false; render();
}

// repairs. Each returns args for a re-mux/re-encode into a new file; the original is never touched.
const FIXES = [
  { id: 'remux', title: 'Rebuild the container', desc: 'Copies the video and audio into a fresh file. Fixes broken headers, missing length and seek problems without re-encoding.', args: ['-fflags', '+genpts+discardcorrupt', '-i', '{in0}', '-map', '0', '-c', 'copy', '-ignore_unknown'], ext: 'mkv', needs: 'header' },
  { id: 'reencode', title: 'Re-encode and skip bad parts', desc: 'Decodes everything and writes new video and audio, dropping frames that cannot be read. Takes longer but handles heavier damage.', args: ['-err_detect', 'ignore_err', '-fflags', '+genpts+discardcorrupt', '-i', '{in0}', '-map', '0:v?', '-map', '0:a?', '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'], ext: 'mp4', needs: 'header' },
  { id: 'sync', title: 'Fix audio out of sync', desc: 'Regenerates timestamps and keeps audio and video aligned. Useful when sound drifts or lags behind the picture.', args: ['-fflags', '+genpts', '-i', '{in0}', '-map', '0:v?', '-map', '0:a?', '-c:v', 'copy', '-af', 'aresample=async=1:first_pts=0', '-c:a', 'aac', '-b:a', '192k'], ext: 'mp4', needs: 'header' },
  { id: 'audio', title: 'Save the audio only', desc: 'If the picture is lost, keep the sound as a clean audio file.', args: ['-err_detect', 'ignore_err', '-i', '{in0}', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k'], ext: 'mp3', needs: 'audio' },
  { id: 'raw', title: 'Recover the video picture only', desc: 'Ignores the audio and re-encodes only the video, which helps when the audio track is the corrupted part.', args: ['-err_detect', 'ignore_err', '-fflags', '+genpts+discardcorrupt', '-i', '{in0}', '-an', '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p'], ext: 'mp4', needs: 'video' },
];

async function applyFix(fx) {
  if (busy) return; const base = file.name.replace(/\.[^.]+$/, '');
  const dest = await window.host.saveFile({ name: base + '-repaired.' + fx.ext, filters: [[fx.ext.toUpperCase() + ' file', [fx.ext]]] }); if (!dest) return;
  busy = true; lastFix = null; render('Repairing: ' + fx.title);
  try {
    const dur = (report && report.dur) || 0;
    window.host.onProgress((pr) => { const el = $('#chkbar'); if (el && dur) el.style.width = Math.min(99, (pr.t / dur) * 100) + '%'; });
    const args = fx.args.filter((x) => x !== '-ignore_unknown'); args.push('{out}');
    const r = await window.host.run({ args, inputs: [file.fid], out: dest.id, duration: dur });
    const p = await window.host.probe(dest.id);
    const ok = p.json && p.json.streams && p.json.streams.length;
    lastFix = { ok: !!ok, name: dest.name, id: dest.id, size: r.size, fx };
  } catch (e) { lastFix = { ok: false, err: String(e.message || e).replace(/^Error invoking remote method '[^']+': Error: /, ''), fx }; }
  busy = false; render();
}

function render(msg) {
  stage.textContent = '';
  if (!file) { stage.append(h('div', { style: 'text-align:center;padding:50px;color:var(--text-2)' }, h('div', { style: 'font-size:15px;color:var(--text);margin-bottom:10px', text: 'Open a damaged or suspicious video or audio file' }), btn('Open file', openFile, 'primary'), h('div', { style: 'margin-top:16px;font-size:12px', text: 'Mendout checks it, explains what is wrong, and saves a repaired copy. Your original is never changed.' }))); renderRight(); renderStatus(); return; }
  stage.append(h('h2', { text: file.name, style: 'margin:0 0 4px 0;font-size:16px' }), h('div', { class: 'muted', text: fmtSize(file.size) }));
  if (busy) stage.append(h('div', { style: 'margin:18px 0' }, h('div', { text: msg || 'Working...', style: 'margin-bottom:8px' }), h('div', { class: 'progress', style: 'max-width:420px' }, h('div', { id: 'chkbar', style: 'width:5%' }))));
  if (report) {
    const verdictText = { healthy: 'No problems found', suspect: 'This file may have problems', damaged: 'This file is damaged' }[report.verdict];
    stage.append(h('div', { style: 'margin:18px 0 8px;font-size:15px;font-weight:600', text: verdictText }));
    const list = h('div', { style: 'display:flex;flex-direction:column;gap:5px;max-width:640px' });
    for (const it of report.items) list.append(h('div', { style: 'display:flex;gap:10px;font-size:13px;' + (it.level === 'info' ? 'color:var(--text-2);padding-left:70px' : '') }, it.level === 'info' ? null : h('span', { style: 'width:60px;flex-shrink:0;text-transform:uppercase;font-size:11px;letter-spacing:.04em;padding-top:2px;' + ({ ok: 'color:var(--text-2)', warn: 'color:#e0e0e0', bad: 'color:#ffffff;font-weight:700' })[it.level], text: ({ ok: 'OK', warn: 'Note', bad: 'Problem' })[it.level] }), h('span', { text: it.text })));
    stage.append(list);
  }
  if (lastFix) {
    stage.append(h('div', { style: 'margin-top:20px;padding:12px;border:1px solid var(--line-2);border-radius:6px;max-width:640px' },
      lastFix.ok ? h('div', {}, h('div', { style: 'font-weight:600', text: 'Saved repaired copy' }), h('div', { class: 'muted', text: lastFix.name + ' (' + fmtSize(lastFix.size) + ')' }), h('div', { style: 'margin-top:8px' }, btn('Show in folder', () => window.host.reveal(lastFix.id))))
        : h('div', {}, h('div', { style: 'font-weight:600', text: 'This repair did not work' }), h('div', { class: 'muted', style: 'white-space:pre-wrap;font-size:12px', text: (lastFix.err || 'The result could not be read.').slice(-400) }), h('div', { style: 'margin-top:6px', text: 'Try another repair method on the right.' }))));
  }
  renderRight(); renderStatus();
}
function renderRight() {
  right.textContent = '';
  right.append(h('h3', { text: 'Repair' }));
  if (!file) { right.append(h('div', { class: 'muted', text: 'Open a file to see repair options.' })); return; }
  if (!report) { right.append(h('div', { class: 'muted', text: busy ? 'Please wait...' : 'Run a check first.' })); return; }
  if (report.verdict === 'healthy') right.append(h('div', { class: 'muted', style: 'margin-bottom:10px', text: 'Nothing to repair, but you can still rebuild the file if it will not play in some programs.' }));
  const ok = (fx) => (fx.needs === 'header' ? report.header : fx.needs === 'audio' ? report.header && report.hasAudio : report.header && report.hasVideo);
  for (const fx of FIXES) {
    const box = h('div', { style: 'margin-bottom:12px;padding:10px;border:1px solid var(--line);border-radius:6px' }, h('div', { style: 'font-weight:600;margin-bottom:3px', text: fx.title }), h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px', text: fx.desc }));
    const b = btn('Repair to new file', () => applyFix(fx)); b.disabled = busy || !ok(fx); box.append(b); right.append(box);
  }
  if (!report.header) right.append(h('div', { class: 'muted', style: 'font-size:12px', text: 'The header is unreadable, so the repair methods are unavailable. Files from a recording that was interrupted often need a similar, healthy file from the same device to recover; Mendout cannot do that yet.' }));
}
function renderStatus() { status.textContent = ''; status.append(h('span', { text: file ? file.name : 'No file' }), h('span', { class: 'grow' }), h('span', { text: busy ? 'Working...' : 'Ready' })); }
render();
