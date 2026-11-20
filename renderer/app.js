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

const IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff'];
const kindOf = (n) => { const e = (String(n).split('.').pop() || '').toLowerCase(); return IMG_EXT.includes(e) ? 'image' : e === 'pdf' ? 'pdf' : 'media'; };
const FILTERS = [['Damaged files', [...IMG_EXT, 'pdf', 'mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', 'ts', '3gp', 'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma']], ['Media files', ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', 'ts', '3gp', 'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma']], ['All files', ['*']]];
async function openFile() {
  const f = (await window.host.openFiles({ read: false, filters: FILTERS }))[0]; if (!f) return;
  file = { fid: f.id, name: f.name, size: f.size, probe: null, kind: kindOf(f.name) }; report = null; lastFix = null;
  render(); await runCheck();
}

// A decode pass with ffmpeg to /dev/null-like sink: we write to a temp file with "-f null" is not allowed (needs {out}); use temp mkv/wav instead.
async function runCheck() {
  if (!file || busy) return; busy = true; report = null; render('Checking the file...');
  if (file.kind === 'image') { try { report = await checkImage(); } catch (e) { report = { items: [{ level: 'bad', text: 'The file could not be read: ' + e.message }], verdict: 'damaged', header: false, kind: 'image' }; } busy = false; render(); return; }
  if (file.kind === 'pdf') { try { report = await checkPdf(); } catch (e) { report = { items: [{ level: 'bad', text: 'The file could not be read: ' + e.message }], verdict: 'damaged', header: false, kind: 'pdf' }; } busy = false; render(); return; }
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

// ---------- images and documents (done in JS, no ffmpeg needed for the structural repairs) ----------
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8, a, b) => { let c = 0xffffffff; for (let i = a; i < b; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const find = (u8, pat, from = 0) => { outer: for (let i = from; i <= u8.length - pat.length; i++) { for (let j = 0; j < pat.length; j++) if (u8[i + j] !== pat[j]) continue outer; return i; } return -1; };
const rfind = (u8, pat) => { outer: for (let i = u8.length - pat.length; i >= 0; i--) { for (let j = 0; j < pat.length; j++) if (u8[i + j] !== pat[j]) continue outer; return i; } return -1; };
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const asciiBytes = (s) => Array.from(s).map((c) => c.charCodeAt(0));
const u32 = (u8, o) => ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
const imgType = (u8) => { const at = (sig) => find(u8, sig, 0); if (at(PNG_SIG) >= 0 && at(PNG_SIG) < 64) return 'png'; const j = find(u8, [0xff, 0xd8, 0xff]); if (j >= 0 && j < 64) return 'jpg'; if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'gif'; if (u8[0] === 0x42 && u8[1] === 0x4d) return 'bmp'; if (u8[0] === 0x52 && u8[1] === 0x49 && u8[8] === 0x57) return 'webp'; return null; };
function pngScan(u8) {
  const st = find(u8, PNG_SIG); const probs = []; if (st < 0) return { probs: ['The PNG signature is missing'], chunks: [], start: -1 };
  if (st > 0) probs.push(st + ' bytes of junk before the image start');
  let o = st + 8; const chunks = []; let end = false;
  while (o + 12 <= u8.length) {
    const len = u32(u8, o), type = String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]);
    if (!/^[A-Za-z]{4}$/.test(type) || len > 0x7fffffff) { probs.push('A chunk header at byte ' + o + ' is damaged'); break; }
    if (o + 12 + len > u8.length) { probs.push('The file is cut off inside a ' + type + ' chunk'); chunks.push({ o, len, type, cut: true }); break; }
    const crcOk = crc32(u8, o + 4, o + 8 + len) === u32(u8, o + 8 + len);
    if (!crcOk) probs.push('The ' + type + ' chunk at byte ' + o + ' fails its checksum');
    chunks.push({ o, len, type, crcOk }); o += 12 + len; if (type === 'IEND') { end = true; break; }
  }
  if (!end) probs.push('The image end marker (IEND) is missing');
  if (!chunks.some((c) => c.type === 'IHDR')) probs.push('The image header (IHDR) is missing');
  if (!chunks.some((c) => c.type === 'IDAT')) probs.push('There is no image data');
  return { probs, chunks, start: st };
}
function pngRepair(u8) {
  const sc = pngScan(u8); if (sc.start < 0) throw new Error('This does not look like a PNG file.');
  const parts = [Uint8Array.from(PNG_SIG)]; let fixed = 0, kept = 0;
  for (const c of sc.chunks) {
    if (c.cut) { if (c.type === 'IDAT') { const body = u8.slice(c.o + 8, u8.length); const full = new Uint8Array(12 + body.length); const dv = new DataView(full.buffer); dv.setUint32(0, body.length); full.set(asciiBytes('IDAT'), 4); full.set(body, 8); dv.setUint32(8 + body.length, crc32(full, 4, 8 + body.length)); parts.push(full); fixed++; } break; }
    const seg = u8.slice(c.o, c.o + 12 + c.len);
    if (!c.crcOk) { new DataView(seg.buffer).setUint32(8 + c.len, crc32(seg, 4, 8 + c.len)); fixed++; }
    if (c.type === 'IEND') continue; parts.push(seg); kept++;
  }
  parts.push(Uint8Array.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]));
  return { data: concat(parts), note: kept + ' chunks kept, ' + fixed + ' repaired' };
}
function jpgRepair(u8) {
  const s = find(u8, [0xff, 0xd8, 0xff]); if (s < 0) throw new Error('This does not look like a JPEG file.');
  let e = rfind(u8, [0xff, 0xd9]);
  let body = u8.slice(s, e > s ? e + 2 : u8.length);
  if (!(e > s)) { const t = new Uint8Array(body.length + 2); t.set(body); t[body.length] = 0xff; t[body.length + 1] = 0xd9; body = t; }
  return { data: body, note: (s ? s + ' junk bytes removed; ' : '') + (e > s ? 'end marker kept' : 'end marker added') };
}
const concat = (parts) => { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

async function checkImage() {
  const u8 = await window.host.readFile(file.fid); file.bytes = u8; const items = []; const t = imgType(u8);
  if (!u8.length) return { items: [{ level: 'bad', text: 'The file is empty (0 bytes)' }], verdict: 'damaged', header: false, kind: 'image' };
  if (!t) items.push({ level: 'bad', text: 'The start of the file does not match any known picture type' });
  else items.push({ level: 'ok', text: 'The file starts like a ' + t.toUpperCase() + ' picture' });
  if (t === 'png') { const sc = pngScan(u8); sc.probs.forEach((p) => items.push({ level: 'bad', text: p })); if (!sc.probs.length) items.push({ level: 'ok', text: 'All PNG chunks and checksums are correct' }); }
  if (t === 'jpg') { const e = rfind(u8, [0xff, 0xd9]); if (e < 0 || u8.length - e > 4096) items.push({ level: 'bad', text: 'The JPEG end marker is missing, so the file was probably cut off' }); else items.push({ level: 'ok', text: 'The JPEG end marker is present' }); }
  // decode test via ffmpeg
  try { const r = await window.host.run({ args: ['-v', 'error', '-err_detect', 'explode', '-i', '{in0}', '-frames:v', '1', '{out}'], inputs: [file.fid], out: 'temp:png' }); window.host.removeFile(r.id); const log = String(r.log || '').trim(); if (log) { items.push({ level: 'bad', text: 'Problems found while decoding the picture:' }); log.split(/\r?\n/).slice(-3).forEach((l) => items.push({ level: 'info', text: l.slice(0, 140) })); } else items.push({ level: 'ok', text: 'The picture decodes completely' }); }
  catch (e) { items.push({ level: 'bad', text: 'The picture cannot be decoded' }); items.push({ level: 'info', text: String(e.message || e).replace(/^Error invoking remote method '[^']+': Error: /, '').trim().split('\n').slice(-2).join(' ').slice(0, 140) }); }
  const verdict = items.some((i) => i.level === 'bad') ? 'damaged' : 'healthy';
  return { items, verdict, header: !!t, kind: 'image', imgType: t };
}

function pdfScan(u8) {
  const str = Array.from({ length: Math.ceil(u8.length / 32768) }, (_, i) => String.fromCharCode.apply(null, u8.subarray(i * 32768, (i + 1) * 32768))).join('');
  const hd = str.indexOf('%PDF-'); const probs = [];
  if (hd < 0) return { probs: ['The %PDF header is missing'], str, hd };
  if (hd > 0) probs.push(hd + ' bytes of junk before the header');
  const tail = str.slice(-1100); const eof = tail.indexOf('%%EOF');
  if (eof < 0) probs.push('The end-of-file marker is missing, so the file was probably cut off');
  const sx = /startxref\s+(\d+)/g; let m, last = null; while ((m = sx.exec(tail))) last = +m[1];
  if (last == null) probs.push('The pointer to the cross-reference table is missing');
  else { const at = str.slice(hd + last, hd + last + 40); if (!/^\s*(xref|\d+\s+\d+\s+obj)/.test(at)) probs.push('The cross-reference table is not where the file says it is'); }
  return { probs, str, hd };
}
async function checkPdf() {
  const u8 = await window.host.readFile(file.fid); file.bytes = u8; const items = [];
  if (!u8.length) return { items: [{ level: 'bad', text: 'The file is empty (0 bytes)' }], verdict: 'damaged', header: false, kind: 'pdf' };
  const sc = pdfScan(u8);
  if (sc.hd < 0) return { items: [{ level: 'bad', text: 'This does not look like a PDF: the %PDF header is missing' }], verdict: 'damaged', header: false, kind: 'pdf' };
  const ver = /%PDF-(\d\.\d)/.exec(sc.str); items.push({ level: 'ok', text: 'PDF header found' + (ver ? ' (version ' + ver[1] + ')' : '') });
  const objs = (sc.str.match(/\d+\s+\d+\s+obj\b/g) || []).length; const pages = (sc.str.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  items.push({ level: objs ? 'ok' : 'bad', text: objs + ' objects found' + (pages ? ', about ' + pages + ' page(s)' : '') });
  if (/\/Encrypt\b/.test(sc.str)) items.push({ level: 'warn', text: 'The document is password protected. Repair keeps it protected only if the structure is intact.' });
  if (/\/Type\s*\/ObjStm/.test(sc.str)) items.push({ level: 'info', text: 'Uses compressed object streams' });
  sc.probs.forEach((p) => items.push({ level: 'bad', text: p }));
  if (!sc.probs.length) items.push({ level: 'ok', text: 'The file ends correctly and its table points to the right place' });
  return { items, verdict: items.some((i) => i.level === 'bad') ? 'damaged' : items.some((i) => i.level === 'warn') ? 'suspect' : 'healthy', header: true, kind: 'pdf' };
}
function pdfRepair(u8) {
  const sc = pdfScan(u8); if (sc.hd < 0) throw new Error('This does not look like a PDF.');
  let str = sc.str.slice(sc.hd);
  if (/\/Type\s*\/ObjStm/.test(str) && !/\/Type\s*\/Catalog/.test(str.replace(/stream[\s\S]*?endstream/g, ''))) throw new Error('This document hides its main catalog in a compressed object stream, which cannot be rebuilt offline.');
  const re = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g; let m; const tab = new Map(); let lastEnd = -1;
  while ((m = re.exec(str))) { const off = m.index + m[0].indexOf(m[1]); tab.set(+m[1], { off, gen: +m[2] }); }
  const ee = /endobj/g; while ((m = ee.exec(str))) lastEnd = m.index + 6;
  if (!tab.size || lastEnd < 0) throw new Error('No readable objects were found in this file.');
  // root
  let root = null; const rr = /\/Root\s+(\d+)\s+(\d+)\s+R/g; while ((m = rr.exec(str))) root = { n: +m[1], g: +m[2] };
  if (!root) { for (const [n, v] of tab) { const seg = str.slice(v.off, v.off + 400); if (/\/Type\s*\/Catalog/.test(seg)) root = { n, g: v.gen }; } }
  if (!root || !tab.has(root.n)) throw new Error('The document catalog could not be found.');
  let info = null; const ir = /\/Info\s+(\d+)\s+(\d+)\s+R/g; while ((m = ir.exec(str))) if (tab.has(+m[1])) info = { n: +m[1], g: +m[2] };
  const keep = str.slice(0, lastEnd) + '\n'; const xoff = keep.length; const max = Math.max(...tab.keys());
  const pad = (n, w) => String(n).padStart(w, '0');
  let x = 'xref\n0 ' + (max + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i <= max; i++) { const v = tab.get(i); x += v ? pad(v.off, 10) + ' ' + pad(v.gen, 5) + ' n \n' : '0000000000 00000 f \n'; }
  x += 'trailer\n<< /Size ' + (max + 1) + ' /Root ' + root.n + ' ' + root.g + ' R' + (info ? ' /Info ' + info.n + ' ' + info.g + ' R' : '') + ' >>\nstartxref\n' + xoff + '\n%%EOF\n';
  const all = keep + x; const out = new Uint8Array(all.length); for (let i = 0; i < all.length; i++) out[i] = all.charCodeAt(i) & 255;
  return { data: out, note: tab.size + ' objects indexed' };
}

// repairs. Each returns args for a re-mux/re-encode into a new file; the original is never touched.
const FIXES = [
  { id: 'remux', title: 'Rebuild the container', desc: 'Copies the video and audio into a fresh file. Fixes broken headers, missing length and seek problems without re-encoding.', args: ['-fflags', '+genpts+discardcorrupt', '-i', '{in0}', '-map', '0', '-c', 'copy', '-ignore_unknown'], ext: 'mkv', needs: 'header' },
  { id: 'reencode', title: 'Re-encode and skip bad parts', desc: 'Decodes everything and writes new video and audio, dropping frames that cannot be read. Takes longer but handles heavier damage.', args: ['-err_detect', 'ignore_err', '-fflags', '+genpts+discardcorrupt', '-i', '{in0}', '-map', '0:v?', '-map', '0:a?', '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'], ext: 'mp4', needs: 'header' },
  { id: 'sync', title: 'Fix audio out of sync', desc: 'Regenerates timestamps and keeps audio and video aligned. Useful when sound drifts or lags behind the picture.', args: ['-fflags', '+genpts', '-i', '{in0}', '-map', '0:v?', '-map', '0:a?', '-c:v', 'copy', '-af', 'aresample=async=1:first_pts=0', '-c:a', 'aac', '-b:a', '192k'], ext: 'mp4', needs: 'header' },
  { id: 'audio', title: 'Save the audio only', desc: 'If the picture is lost, keep the sound as a clean audio file.', args: ['-err_detect', 'ignore_err', '-i', '{in0}', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k'], ext: 'mp3', needs: 'audio' },
  { id: 'raw', title: 'Recover the video picture only', desc: 'Ignores the audio and re-encodes only the video, which helps when the audio track is the corrupted part.', args: ['-err_detect', 'ignore_err', '-fflags', '+genpts+discardcorrupt', '-i', '{in0}', '-an', '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p'], ext: 'mp4', needs: 'video' },
];

const FIXES_IMG = [
  { id: 'img-struct', title: 'Repair the picture file', desc: 'Fixes broken checksums, junk at the start and a missing end, and keeps every pixel that is still readable. Works on PNG and JPEG.', js: (u8) => (imgType(u8) === 'png' ? pngRepair(u8) : imgType(u8) === 'jpg' ? jpgRepair(u8) : (() => { throw new Error('Structural repair works on PNG and JPEG files. Try re-encoding instead.'); })()), ext: () => (report.imgType === 'png' ? 'png' : 'jpg'), needs: 'header' },
  { id: 'img-png', title: 'Re-encode as PNG', desc: 'Decodes what can be read, ignoring errors, and saves a fresh lossless PNG. Damaged areas stay gray or blank.', args: ['-err_detect', 'ignore_err', '-i', '{in0}', '-frames:v', '1'], ext: 'png', needs: 'any' },
  { id: 'img-jpg', title: 'Re-encode as JPEG', desc: 'Decodes what can be read, ignoring errors, and saves a fresh high-quality JPEG.', args: ['-err_detect', 'ignore_err', '-i', '{in0}', '-frames:v', '1', '-q:v', '2'], ext: 'jpg', needs: 'any' },
];
const FIXES_PDF = [
  { id: 'pdf-xref', title: 'Rebuild the document index', desc: 'Scans the file for every page and object, then writes a new index and end marker. Fixes cut-off files and documents that will not open.', js: pdfRepair, ext: 'pdf', needs: 'header' },
];
const FIXES_AUDIO = [
  { id: 'a-wav', title: 'Save as WAV, skipping damage', desc: 'Decodes the sound, skips unreadable parts and writes a clean uncompressed file.', args: ['-err_detect', 'ignore_err', '-fflags', '+discardcorrupt', '-i', '{in0}', '-vn', '-c:a', 'pcm_s16le'], ext: 'wav', needs: 'audio' },
  { id: 'a-flac', title: 'Save as FLAC, skipping damage', desc: 'Same recovery as WAV but in a smaller lossless file.', args: ['-err_detect', 'ignore_err', '-fflags', '+discardcorrupt', '-i', '{in0}', '-vn', '-c:a', 'flac'], ext: 'flac', needs: 'audio' },
];
const fixList = () => (file.kind === 'image' ? FIXES_IMG : file.kind === 'pdf' ? FIXES_PDF : report && report.hasVideo === false ? [...FIXES.filter((f) => f.needs === 'header' && f.id !== 'reencode'), ...FIXES_AUDIO, ...FIXES.filter((f) => f.id === 'audio')] : FIXES);

async function applyFix(fx) {
  if (busy) return; const base = file.name.replace(/\.[^.]+$/, ''); const ext = typeof fx.ext === 'function' ? fx.ext() : fx.ext;
  if (fx.js) {
    busy = true; lastFix = null; render('Repairing: ' + fx.title);
    try {
      const res = fx.js(file.bytes || await window.host.readFile(file.fid));
      const dest = await window.host.saveFile({ name: base + '-repaired.' + ext, filters: [[ext.toUpperCase() + ' file', [ext]]], data: res.data });
      if (!dest) { busy = false; render(); return; }
      lastFix = { ok: true, name: dest.name, id: dest.id, size: res.data.length, fx, note: res.note };
    } catch (e) { lastFix = { ok: false, err: String(e.message || e), fx }; }
    busy = false; render(); return;
  }
  const dest = await window.host.saveFile({ name: base + '-repaired.' + ext, filters: [[ext.toUpperCase() + ' file', [ext]]] }); if (!dest) return;
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
  if (!file) { stage.append(h('div', { style: 'text-align:center;padding:50px;color:var(--text-2)' }, h('div', { style: 'font-size:15px;color:var(--text);margin-bottom:10px', text: 'Open a damaged or suspicious video, audio, picture or PDF file' }), btn('Open file', openFile, 'primary'), h('div', { style: 'margin-top:16px;font-size:12px', text: 'Mendout checks it, explains what is wrong, and saves a repaired copy. Your original is never changed.' }))); renderRight(); renderStatus(); return; }
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
      lastFix.ok ? h('div', {}, h('div', { style: 'font-weight:600', text: 'Saved repaired copy' }), h('div', { class: 'muted', text: lastFix.name + ' (' + fmtSize(lastFix.size) + ')' + (lastFix.note ? ' - ' + lastFix.note : '') }), h('div', { style: 'margin-top:8px' }, btn('Show in folder', () => window.host.reveal(lastFix.id))))
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
  const ok = (fx) => (fx.needs === 'any' ? true : fx.needs === 'header' ? report.header : fx.needs === 'audio' ? report.header && report.hasAudio : report.header && report.hasVideo);
  for (const fx of fixList()) {
    const box = h('div', { style: 'margin-bottom:12px;padding:10px;border:1px solid var(--line);border-radius:6px' }, h('div', { style: 'font-weight:600;margin-bottom:3px', text: fx.title }), h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px', text: fx.desc }));
    const b = btn('Repair to new file', () => applyFix(fx)); b.disabled = busy || !ok(fx); box.append(b); right.append(box);
  }
  if (!report.header && !file.kind.match(/image|pdf/) || (!report.header && file.kind === 'pdf')) right.append(h('div', { class: 'muted', style: 'font-size:12px', text: 'The header is unreadable, so the repair methods are unavailable. Files from a recording that was interrupted often need a similar, healthy file from the same device to recover; Mendout cannot do that yet.' }));
}
function renderStatus() { status.textContent = ''; status.append(h('span', { text: file ? file.name : 'No file' }), h('span', { class: 'grow' }), h('span', { text: busy ? 'Working...' : 'Ready' })); }
render();
