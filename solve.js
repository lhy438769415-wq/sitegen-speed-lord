// makefun-site 1.0.0-compatible static site generator.
// run(input) returns the output tree ({path: text}) that makefun-site 1.0.0's
// build returns for the same input, byte for byte. Dependency-free ES module.
// Written from the makefun-site README (its own front matter, template dialect,
// Markdown subset, slug rule and report) plus black-box probes of the reference.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
const FM_KEYS = new Set(['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug']);
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const NON_ASCII_RE = /[^\x00-\x7F]/;
const MARKS_RE = /\p{M}/gu;
const NON_ALNUM_RUN_RE = /[^a-z0-9]+/g;
const BLANK_RE = /^[ \t]*$/;
const TRAIL_ST_RE = /[ \t]+$/;
const FENCE_OPEN_RE = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE_RE = /^```[ \t]*$/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const HR_DASH_RE = /^---[ \t]*$/;
const HR_STAR_RE = /^\*\*\*[ \t]*$/;
const BULLET_RE = /^[-*] /;
const ORDERED_RE = /^(\d+)\. /;
const CONTINUATION_RE = /^ {2,}\S/;
const FM_LINE_RE = /^([a-z_]+):(.*)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LAYOUT_NAME_RE = /^[a-z0-9-]+$/;
const SLUG_VALUE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FOR_TAG_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_TAG_RE = /^if (not )?(\S+)$/;
const INCLUDE_TAG_RE = /^include "([a-z0-9-]+)"$/;
const WS_RE = /\s/;
const ESCAPABLES = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

function esc(s) {
  return s.replace(ESC_RE, (c) => ESC_MAP[c]);
}

function escChar(c) {
  return ESC_MAP[c] || c;
}

function trimST(s) {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === ' ' || s[a] === '\t')) a++;
  while (b > a && (s[b - 1] === ' ' || s[b - 1] === '\t')) b--;
  return a === 0 && b === s.length ? s : s.slice(a, b);
}

function isBlank(line) {
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (c !== ' ' && c !== '\t') return false;
  }
  return true;
}

function isLeap(y) {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function slugOf(text) {
  let s = text;
  if (NON_ASCII_RE.test(s)) s = s.normalize('NFKD').replace(MARKS_RE, '');
  s = s.toLowerCase().replace(NON_ALNUM_RUN_RE, '-');
  let a = 0;
  let b = s.length;
  while (a < b && s[a] === '-') a++;
  while (b > a && s[b - 1] === '-') b--;
  s = s.slice(a, b);
  if (s.length > 64) {
    s = s.slice(0, 64);
    if (s.endsWith('-')) s = s.slice(0, -1);
  }
  return s || 'untitled';
}

function uniqueSlug(base, taken) {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  while (taken.has(base + '-' + n)) n++;
  const s = base + '-' + n;
  taken.add(s);
  return s;
}

function dateLong(dateStr) {
  const y = +dateStr.slice(0, 4);
  const m = +dateStr.slice(5, 7);
  const d = +dateStr.slice(8, 10);
  return d + ' ' + MONTH_NAMES[m - 1] + ' ' + y;
}

function isValidDate(v) {
  if (!DATE_RE.test(v)) return false;
  const y = +v.slice(0, 4);
  const m = +v.slice(5, 7);
  const d = +v.slice(8, 10);
  if (y < 1970 || y > 2099 || m < 1 || m > 12 || d < 1) return false;
  const dim = DAYS_IN_MONTH[m - 1] + (m === 2 && isLeap(y) ? 1 : 0);
  return d <= dim;
}

// --- front matter -------------------------------------------------------

function parseQuotedOrBare(value) {
  // Returns {value} on success or {error} with the reason.
  if (value[0] === '"') {
    if (value.length < 2 || value[value.length - 1] !== '"') {
      return { error: 'a quoted string is not closed' };
    }
    let out = '';
    for (let i = 1; i < value.length - 1; i++) {
      const c = value[i];
      if (c === '"') return { error: 'a quoted string holds a stray quote' };
      if (c === '\\') {
        const nx = value[i + 1];
        if (nx === '"' || nx === '\\') {
          out += nx;
          i++;
        } else {
          return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        }
      } else {
        out += c;
      }
    }
    return { value: out };
  }
  if (value[0] === '[') return { error: 'a bare string opens on [' };
  return { value };
}

function validateFmValue(key, value, fm) {
  // Returns null on success (and stores into fm), else the reason.
  switch (key) {
    case 'title':
    case 'summary': {
      const r = parseQuotedOrBare(value);
      if (r.error) return 'key "' + key + '": ' + r.error;
      fm[key] = r.value;
      return null;
    }
    case 'date':
      if (!isValidDate(value)) {
        return 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)';
      }
      fm.date = value;
      return null;
    case 'tags': {
      if (value[0] !== '[' || value[value.length - 1] !== ']') {
        return 'key "tags": not a list [a, b]';
      }
      const inner = trimST(value.slice(1, -1));
      if (inner === '') {
        fm.tags = [];
        return null;
      }
      const parts = inner.split(',');
      const tags = [];
      for (const p of parts) {
        const t = trimST(p);
        if (t === '' || t.includes('"') || t.includes('[') || t.includes(']')) {
          return 'key "tags": an empty tag, or one holding " [ or ]';
        }
        tags.push(t);
      }
      fm.tags = tags;
      return null;
    }
    case 'draft':
      if (value === 'true') {
        fm.draft = true;
        return null;
      }
      if (value === 'false') {
        fm.draft = false;
        return null;
      }
      return 'key "draft": true or false';
    case 'layout':
      if (!LAYOUT_NAME_RE.test(value)) return 'key "layout": not a template name';
      fm.layout = value;
      return null;
    case 'slug':
      if (value.length > 64 || !SLUG_VALUE_RE.test(value)) {
        return 'key "slug": not a slug';
      }
      fm.slug = value;
      return null;
    default:
      return null;
  }
}

function parseFrontMatter(content) {
  // content has already had \r\n and lone \r turned into \n.
  // Returns {fm, body} or {error}.
  const lines = content.split('\n');
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close < 0) return { error: 'the front matter is not closed' };
  const fm = {};
  const seen = new Set();
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (isBlank(line)) continue;
    if (line[0] === '#') continue;
    const m = FM_LINE_RE.exec(line);
    if (!m || (m[2] !== '' && m[2][0] !== ' ')) {
      return { error: 'line ' + (i + 1) + ' is not "key: value"' };
    }
    const key = m[1];
    if (!FM_KEYS.has(key)) return { error: 'unknown key "' + key + '"' };
    let value = m[2] === '' ? '' : m[2].slice(1);
    value = value.replace(TRAIL_ST_RE, '');
    // A non-empty value is validated before the duplicate check (a repeated
    // key with a bad value reports the value's error); an empty value is
    // only "has no value" once it is known not to be a repeat.
    if (value !== '') {
      const err = validateFmValue(key, value, fm);
      if (err) return { error: err };
    }
    if (seen.has(key)) return { error: 'key "' + key + '" is given twice' };
    seen.add(key);
    if (value === '') return { error: 'key "' + key + '" has no value' };
  }
  if (!seen.has('title')) return { error: 'no title' };
  return { fm, body: lines.slice(close + 1).join('\n') };
}

// --- templates ----------------------------------------------------------
// Node kinds (arrays): ['t', text] ['v', segs, raw] ['f', varName, segs, body]
// ['i', segs, negated, thenBody, elseBody|null] ['c', name]

function validPath(s) {
  if (s === '') return false;
  const parts = s.split('.');
  for (const p of parts) {
    if (!NAME_RE.test(p)) return false;
  }
  return true;
}

function parseTemplate(src) {
  // Returns {nodes} or {error}.
  const root = [];
  let cur = root;
  const stack = [];
  let i = 0;
  let textStart = 0;
  const n = src.length;
  while (i < n) {
    const jVar = src.indexOf('{{', i);
    const jTag = src.indexOf('{%', i);
    let j = -1;
    let kind = '';
    if (jVar >= 0 && (jTag < 0 || jVar < jTag)) {
      j = jVar;
      kind = src[j + 2] === '{' ? 'raw' : 'var';
    } else if (jTag >= 0) {
      j = jTag;
      kind = 'tag';
    } else {
      break;
    }
    if (kind === 'tag') {
      const close = src.indexOf('%}', j + 2);
      if (close < 0) return { error: 'a {% is not closed' };
      const inner = trimST(src.slice(j + 2, close));
      // Standalone line? Only spaces/tabs beside the tag on its line.
      const lineStart = src.lastIndexOf('\n', j - 1) + 1;
      const before = src.slice(lineStart, j);
      const afterEnd = close + 2;
      const nl = src.indexOf('\n', afterEnd);
      const afterText = nl < 0 ? src.slice(afterEnd) : src.slice(afterEnd, nl);
      const standalone = BLANK_RE.test(before) && BLANK_RE.test(afterText);
      const textEnd = standalone ? lineStart : j;
      if (textEnd > textStart) cur.push(['t', src.slice(textStart, textEnd)]);
      if (inner === 'endfor') {
        if (stack.length === 0 || stack[stack.length - 1].type !== 'for') {
          return { error: 'an endfor with no open for' };
        }
        cur = stack.pop().parent;
      } else if (inner === 'endif') {
        if (stack.length === 0 || stack[stack.length - 1].type !== 'if') {
          return { error: 'an endif with no open if' };
        }
        cur = stack.pop().parent;
      } else if (inner === 'else') {
        const top = stack[stack.length - 1];
        if (!top || top.type !== 'if' || top.inElse) {
          return { error: 'an else outside an if' };
        }
        top.inElse = true;
        top.node[4] = [];
        cur = top.node[4];
      } else if (inner.startsWith('for ')) {
        const m = FOR_TAG_RE.exec(inner);
        if (!m) return { error: '{% ' + inner + ' %} is not a tag' };
        if (!validPath(m[2])) return { error: '"' + m[2] + '" is not a path' };
        const node = ['f', m[1], m[2].split('.'), []];
        cur.push(node);
        stack.push({ type: 'for', node, parent: cur });
        cur = node[3];
      } else if (inner.startsWith('if ')) {
        const m = IF_TAG_RE.exec(inner);
        if (!m) return { error: '{% ' + inner + ' %} is not a tag' };
        if (!validPath(m[2])) return { error: '"' + m[2] + '" is not a path' };
        const node = ['i', m[2].split('.'), !!m[1], [], null];
        cur.push(node);
        stack.push({ type: 'if', node, parent: cur, inElse: false });
        cur = node[3];
      } else if (inner.startsWith('include ')) {
        const m = INCLUDE_TAG_RE.exec(inner);
        if (!m) return { error: '{% ' + inner + ' %} is not a tag' };
        cur.push(['c', m[1]]);
      } else {
        return { error: '{% ' + inner + ' %} is not a tag' };
      }
      i = standalone ? (nl < 0 ? n : nl + 1) : afterEnd;
      textStart = i;
    } else {
      const raw = kind === 'raw';
      const openLen = raw ? 3 : 2;
      const closeStr = raw ? '}}}' : '}}';
      const close = src.indexOf(closeStr, j + openLen);
      if (close < 0) {
        return { error: raw ? 'a {{{ is not closed' : 'a {{ is not closed' };
      }
      const inner = trimST(src.slice(j + openLen, close));
      if (!validPath(inner)) return { error: '"' + inner + '" is not a path' };
      if (j > textStart) cur.push(['t', src.slice(textStart, j)]);
      cur.push(['v', inner.split('.'), raw]);
      i = close + closeStr.length;
      textStart = i;
    }
  }
  if (textStart < n) cur.push(['t', src.slice(textStart)]);
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    return { error: 'a ' + top.type + ' is not closed' };
  }
  return { nodes: root };
}

function resolvePath(segs, ctx) {
  const first = segs[0];
  const frames = ctx.frames;
  let v;
  let found = false;
  for (let k = frames.length - 1; k >= 0; k--) {
    const fr = frames[k];
    if (first === 'loop') {
      v = fr.loop;
      found = true;
      break;
    }
    if (first === fr.name) {
      v = fr.value;
      found = true;
      break;
    }
  }
  if (!found) {
    if (!Object.prototype.hasOwnProperty.call(ctx.root, first)) return undefined;
    v = ctx.root[first];
  }
  for (let k = 1; k < segs.length; k++) {
    if (v === null || typeof v !== 'object') return undefined;
    const s = segs[k];
    if (!Object.prototype.hasOwnProperty.call(v, s)) return undefined;
    v = v[s];
  }
  return v;
}

function writeValue(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let s = '';
    for (let k = 0; k < v.length; k++) {
      if (k) s += ', ';
      s += writeValue(v[k]);
    }
    return s;
  }
  return '';
}

function truthy(v) {
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0 &&
    !(Array.isArray(v) && v.length === 0);
}

const EMPTY_NODES = [];

function renderNodes(nodes, ctx, depth, out) {
  for (let n = 0; n < nodes.length; n++) {
    const node = nodes[n];
    const t = node[0];
    if (t === 't') {
      out.push(node[1]);
    } else if (t === 'v') {
      const s = writeValue(resolvePath(node[1], ctx));
      out.push(node[2] ? s : esc(s));
    } else if (t === 'f') {
      const v = resolvePath(node[2], ctx);
      if (Array.isArray(v)) {
        const len = v.length;
        const body = node[3];
        for (let k = 0; k < len; k++) {
          ctx.frames.push({
            name: node[1],
            value: v[k],
            loop: { index: k + 1, first: k === 0, last: k === len - 1, length: len },
          });
          renderNodes(body, ctx, depth, out);
          ctx.frames.pop();
        }
      }
    } else if (t === 'i') {
      let cond = truthy(resolvePath(node[1], ctx));
      if (node[2]) cond = !cond;
      renderNodes(cond ? node[3] : (node[4] || EMPTY_NODES), ctx, depth, out);
    } else if (t === 'c') {
      if (depth < 8) {
        const target = ctx.templates.get(node[1]);
        if (target) renderNodes(target, ctx, depth + 1, out);
      }
    }
  }
}

function renderTemplate(nodes, root, templates) {
  const out = [];
  renderNodes(nodes, { root, frames: [], templates }, 0, out);
  return out.join('');
}

// --- markdown -----------------------------------------------------------

function findStrongClose(s, from) {
  const n = s.length;
  let j = from;
  while (j < n) {
    const c = s[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '*' && s[j + 1] === '*') return j;
    j++;
  }
  return -1;
}

function findEmClose(s, from) {
  const n = s.length;
  let j = from;
  while (j < n) {
    const c = s[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '*') {
      if (s[j + 1] === '*') {
        j += 2;
        continue;
      }
      return j;
    }
    j++;
  }
  return -1;
}

function inline(s, ctx) {
  let out = '';
  const n = s.length;
  let i = 0;
  while (i < n) {
    // Copy a run of plain text up to the next structural character.
    // Four native indexOf scans beat a char-by-char loop for long runs.
    let j = n;
    let b = s.indexOf('\\', i);
    if (b >= 0 && b < j) j = b;
    b = s.indexOf('`', i);
    if (b >= 0 && b < j) j = b;
    b = s.indexOf('*', i);
    if (b >= 0 && b < j) j = b;
    b = s.indexOf('[', i);
    if (b >= 0 && b < j) j = b;
    if (j > i) {
      out += esc(s.slice(i, j));
      i = j;
      continue;
    }
    const c = s[i];
    if (c === '\\') {
      if (i + 1 < n && ESCAPABLES.has(s[i + 1])) {
        out += escChar(s[i + 1]);
        i += 2;
      } else {
        out += '\\';
        i++;
      }
      continue;
    }
    if (c === '`') {
      if (s[i + 1] === '`') {
        out += '`';
        i++;
        continue;
      }
      const close = s.indexOf('`', i + 1);
      if (close < 0) {
        out += '`';
        i++;
        continue;
      }
      out += '<code>' + esc(s.slice(i + 1, close)) + '</code>';
      i = close + 1;
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const close = findStrongClose(s, i + 2);
        if (close > i + 2) {
          out += '<strong>' + inline(s.slice(i + 2, close), ctx) + '</strong>';
          i = close + 2;
        } else {
          out += '**';
          i += 2;
        }
      } else {
        const close = findEmClose(s, i + 1);
        if (close > i + 1) {
          out += '<em>' + inline(s.slice(i + 1, close), ctx) + '</em>';
          i = close + 1;
        } else {
          out += '*';
          i++;
        }
      }
      continue;
    }
    // Link: [text](target)
    let k = i + 1;
    let textEnd = -1;
    while (k < n) {
      const ch = s[k];
      if (ch === '\\') {
        k += 2;
        continue;
      }
      if (ch === ']') {
        textEnd = k;
        break;
      }
      k++;
    }
    if (textEnd < 0 || s[textEnd + 1] !== '(') {
      out += '[';
      i++;
      continue;
    }
    const closeParen = s.indexOf(')', textEnd + 2);
    if (closeParen < 0) {
      out += '[';
      i++;
      continue;
    }
    const target = s.slice(textEnd + 2, closeParen);
    if (target === '' || WS_RE.test(target)) {
      out += '[';
      i++;
      continue;
    }
    const href = resolveLink(target, ctx);
    if (href === null) {
      ctx.broken.add(ctx.sourcePath + '\n' + target);
    }
    out += '<a href="' + esc(href === null ? target : href) + '">' +
      inline(s.slice(i + 1, textEnd), ctx) + '</a>';
    i = closeParen + 1;
  }
  return out;
}

function resolveLink(target, ctx) {
  // Returns the href, or null when the link is broken.
  if (target[0] === '/' || target[0] === '#' || SCHEME_RE.test(target)) {
    return target;
  }
  let path = target;
  let frag = '';
  const hash = target.indexOf('#');
  if (hash >= 0) {
    path = target.slice(0, hash);
    frag = target.slice(hash);
  }
  const parts = ctx.dir === '' ? [] : ctx.dir.split('/');
  const segs = path.split('/');
  for (const seg of segs) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  const resolved = parts.join('/');
  const pageUrl = ctx.pageBySource.get(resolved);
  if (pageUrl !== undefined) return pageUrl + frag;
  if (ctx.staticSet.has(resolved)) return ctx.base + '/' + resolved + frag;
  return null;
}

function renderMarkdown(body, ctx) {
  // ctx: {dir, sourcePath, pageBySource, staticSet, base, broken}
  const lines = body.split('\n');
  const n = lines.length;
  let i = 0;
  let html = '';
  const toc = [];
  const ids = new Set();
  let excerpt = '';
  let excerptDone = false;
  while (i < n) {
    const line = lines[i];
    if (line === '' || ((line[0] === ' ' || line[0] === '\t') && isBlank(line))) {
      i++;
      continue;
    }
    const fence =
      line[0] === '`' && line[1] === '`' && line[2] === '`' ? FENCE_OPEN_RE.exec(line) : null;
    if (fence) {
      i++;
      let code = '';
      while (i < n && !(lines[i][0] === '`' && FENCE_CLOSE_RE.test(lines[i]))) {
        code += esc(lines[i]) + '\n';
        i++;
      }
      if (i < n) i++;
      html += '<pre><code' + (fence[1] ? ' class="language-' + fence[1] + '"' : '') +
        '>' + code + '</code></pre>\n';
      continue;
    }
    const hm = line[0] === '#' ? HEADING_RE.exec(line) : null;
    if (hm) {
      const text = trimST(hm[2]);
      if (text !== '') {
        const level = hm[1].length;
        const id = uniqueSlug(slugOf(text), ids);
        const inner = inline(text, ctx);
        html += '<h' + level + ' id="' + id + '">' + inner + '</h' + level + '>\n';
        if (level === 2 || level === 3) toc.push({ level, id, html: inner });
        i++;
        continue;
      }
    }
    if ((line[0] === '-' || line[0] === '*') && (HR_DASH_RE.test(line) || HR_STAR_RE.test(line))) {
      html += '<hr>\n';
      i++;
      continue;
    }
    if (line[0] === '>') {
      const parts = [];
      while (i < n && lines[i][0] === '>') {
        let t = lines[i].slice(1);
        if (t[0] === ' ') t = t.slice(1);
        t = trimST(t);
        if (t !== '') parts.push(t);
        i++;
      }
      if (parts.length === 0) {
        html += '<blockquote>\n</blockquote>\n';
      } else {
        html += '<blockquote>\n<p>' + inline(parts.join('\n'), ctx) + '</p>\n</blockquote>\n';
      }
      continue;
    }
    const c0 = line[0];
    const bullet = (c0 === '-' || c0 === '*') && BULLET_RE.test(line);
    const ordered = c0 >= '0' && c0 <= '9' ? ORDERED_RE.exec(line) : null;
    if (bullet || ordered) {
      let startNum = 0;
      let markerLen;
      if (ordered) {
        startNum = parseInt(ordered[1], 10);
        markerLen = ordered[0].length;
      } else {
        markerLen = 2;
      }
      const items = [trimST(line.slice(markerLen))];
      i++;
      while (i < n) {
        const l = lines[i];
        if (l[0] === ' ' && l[1] === ' ' && CONTINUATION_RE.test(l)) {
          items[items.length - 1] += '\n' + trimST(l);
          i++;
          continue;
        }
        if (ordered) {
          const m2 = l[0] >= '0' && l[0] <= '9' ? ORDERED_RE.exec(l) : null;
          if (m2) {
            items.push(trimST(l.slice(m2[0].length)));
            i++;
            continue;
          }
        } else if ((l[0] === '-' || l[0] === '*') && BULLET_RE.test(l)) {
          items.push(trimST(l.slice(2)));
          i++;
          continue;
        }
        break;
      }
      if (ordered) {
        html += startNum !== 1 ? '<ol start="' + startNum + '">\n' : '<ol>\n';
      } else {
        html += '<ul>\n';
      }
      for (const it of items) html += '<li>' + inline(it, ctx) + '</li>\n';
      html += ordered ? '</ol>\n' : '</ul>\n';
      continue;
    }
    // Paragraph: lines up to a blank line, fence, heading or thematic break.
    const parts = [trimST(line)];
    i++;
    while (i < n) {
      const l = lines[i];
      if (l === '' || ((l[0] === ' ' || l[0] === '\t') && isBlank(l))) break;
      if (l[0] === '`' && l[1] === '`' && l[2] === '`' && FENCE_OPEN_RE.test(l)) break;
      const h2 = l[0] === '#' ? HEADING_RE.exec(l) : null;
      if (h2 && trimST(h2[2]) !== '') break;
      if ((l[0] === '-' || l[0] === '*') && (HR_DASH_RE.test(l) || HR_STAR_RE.test(l))) break;
      parts.push(trimST(l));
      i++;
    }
    const phtml = inline(parts.join('\n'), ctx);
    if (!excerptDone) {
      excerpt = phtml;
      excerptDone = true;
    }
    html += '<p>' + phtml + '</p>\n';
  }
  return { html, toc, excerpt };
}

// --- build --------------------------------------------------------------

export function run(input) {
  const site = input.site || {};
  const templates = input.templates || {};
  const files = input.files || [];
  const base = String(site.base_url ?? '').replace(/\/+$/, '');
  const report = [];
  const out = {};

  const sorted = files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const sources = [];
  const statics = [];
  for (const f of sorted) {
    if (f.path.endsWith('.md')) sources.push(f);
    else statics.push(f);
  }

  const parsed = new Map();
  for (const name of Object.keys(templates).sort()) {
    const r = parseTemplate(templates[name]);
    if (r.error) report.push('template "' + name + '": ' + r.error);
    else parsed.set(name, r.nodes);
  }

  const pages = [];
  const takenByDir = new Map();
  for (const f of sources) {
    const content = f.content.indexOf('\r') < 0 ? f.content : f.content.replace(/\r\n?/g, '\n');
    const parsedFm = parseFrontMatter(content);
    if (parsedFm.error) {
      report.push('refused ' + f.path + ': ' + parsedFm.error);
      continue;
    }
    const fm = parsedFm.fm;
    if (f.path.startsWith('tags/')) {
      report.push('refused ' + f.path + ": tags/ is the generator's own");
      continue;
    }
    if (f.path.startsWith('page/')) {
      report.push('refused ' + f.path + ": page/ is the generator's own");
      continue;
    }
    const isPost = f.path.startsWith('posts/');
    if (isPost && !fm.date) {
      report.push('refused ' + f.path + ': a post needs a date');
      continue;
    }
    const layout = fm.layout || (isPost ? 'post' : 'page');
    if (!parsed.has(layout)) {
      report.push('refused ' + f.path + ': layout "' + layout + '" is no template that parses');
      continue;
    }
    if (fm.draft === true) {
      report.push('draft ' + f.path);
      continue;
    }
    const dir = isPost ? 'posts' : dirOf(f.path);
    let taken = takenByDir.get(dir);
    if (!taken) {
      taken = new Set();
      if (dir === '') {
        taken.add('posts');
        taken.add('tags');
        taken.add('page');
      }
      takenByDir.set(dir, taken);
    }
    const slug = uniqueSlug(fm.slug || slugOf(fm.title), taken);
    const outPath = (dir === '' ? '' : dir + '/') + slug + '/index.html';
    const url = base + '/' + (dir === '' ? '' : dir + '/') + slug + '/';
    pages.push({
      source: f.path,
      fm,
      body: parsedFm.body,
      dir,
      slug,
      outPath,
      url,
      isPost,
    });
  }

  const pageBySource = new Map();
  for (const p of pages) pageBySource.set(p.source, p.url);
  const staticSet = new Set();
  for (const f of statics) staticSet.add(f.path);

  const broken = new Set();
  for (const p of pages) {
    const ctx = {
      dir: p.dir === 'posts' ? dirOf(p.source) : p.dir,
      sourcePath: p.source,
      pageBySource,
      staticSet,
      base,
      broken,
    };
    const md = renderMarkdown(p.body, ctx);
    p.content = md.html;
    p.toc = md.toc;
    p.excerpt = md.excerpt;
    const words = p.body.match(/\S+/g);
    p.readingMinutes = Math.max(1, Math.ceil((words ? words.length : 0) / 200));
  }

  const posts = pages.filter((p) => p.isPost);
  posts.sort((a, b) => {
    if (a.fm.date !== b.fm.date) return a.fm.date < b.fm.date ? 1 : -1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k > 0 ? posts[k - 1] : null;
    posts[k].older = k < posts.length - 1 ? posts[k + 1] : null;
  }

  const tagMap = new Map();
  for (const post of posts) {
    const seen = new Set();
    const list = [];
    for (const name of post.fm.tags || []) {
      const slug = slugOf(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      list.push({ name, slug });
    }
    post.tagList = list;
    for (const t of list) {
      let tag = tagMap.get(t.slug);
      if (!tag) {
        tag = {
          name: t.name,
          slug: t.slug,
          url: base + '/tags/' + t.slug + '/',
          count: 0,
          posts: [],
        };
        tagMap.set(t.slug, tag);
      }
      tag.count++;
      tag.posts.push(post);
    }
  }
  for (const p of pages) {
    if (p.isPost) continue;
    const seen = new Set();
    const list = [];
    for (const name of p.fm.tags || []) {
      const slug = slugOf(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      list.push({ name, slug });
    }
    p.tagList = list;
  }
  const tags = [...tagMap.values()].sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const tagObjs = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.count }));

  const siteObj = { title: site.title, base_url: base };
  const recentCards = posts.slice(0, site.recent).map(cardOf);

  function cardOf(p) {
    return {
      title: p.fm.title,
      url: p.url,
      date: p.fm.date || '',
      date_long: p.fm.date ? dateLong(p.fm.date) : '',
      summary: p.fm.summary || '',
      excerpt: p.excerpt,
      reading_minutes: p.readingMinutes,
      // Each tag is shown under the tag's own name (the first spelling met
      // walking the posts in collection order) when a post has that tag;
      // a tag no post has keeps the page's own spelling.
      tags: (p.tagList || []).map((t) => ({
        name: tagMap.has(t.slug) ? tagMap.get(t.slug).name : t.name,
        slug: t.slug,
        url: tagMap.has(t.slug) ? tagMap.get(t.slug).url : '',
      })),
    };
  }

  function pageObj(p) {
    const card = cardOf(p);
    card.slug = p.slug;
    card.content = p.content;
    card.toc = p.toc;
    card.newer = null;
    card.older = null;
    if (p.isPost) {
      if (p.newer) {
        card.newer = {
          title: p.newer.fm.title,
          url: p.newer.url,
          date: p.newer.fm.date || '',
          date_long: p.newer.fm.date ? dateLong(p.newer.fm.date) : '',
        };
      }
      if (p.older) {
        card.older = {
          title: p.older.fm.title,
          url: p.older.url,
          date: p.older.fm.date || '',
          date_long: p.older.fm.date ? dateLong(p.older.fm.date) : '',
        };
      }
    }
    card.is_post = p.isPost;
    return card;
  }

  for (const p of pages) {
    const root = { site: siteObj, tags: tagObjs, recent: recentCards, page: pageObj(p) };
    out[p.outPath] = renderTemplate(parsed.get(p.fm.layout || (p.isPost ? 'post' : 'page')), root, parsed);
  }

  const perPage = site.per_page;
  let total = Math.ceil(posts.length / perPage);
  if (!isFinite(total) || total < 1) total = 1;
  if (parsed.has('index')) {
    for (let n = 1; n <= total; n++) {
      const slice = posts.slice((n - 1) * perPage, n * perPage);
      const pager = {
        number: n,
        total,
        url: n === 1 ? base + '/' : base + '/page/' + n + '/',
        newer_url: n === 1 ? '' : n === 2 ? base + '/' : base + '/page/' + (n - 1) + '/',
        older_url: n === total ? '' : base + '/page/' + (n + 1) + '/',
      };
      const root = {
        site: siteObj,
        tags: tagObjs,
        recent: recentCards,
        posts: slice.map(cardOf),
        pager,
      };
      out[n === 1 ? 'index.html' : 'page/' + n + '/index.html'] =
        renderTemplate(parsed.get('index'), root, parsed);
    }
  }

  if (parsed.has('tag')) {
    for (const t of tags) {
      const root = {
        site: siteObj,
        tags: tagObjs,
        recent: recentCards,
        tag: {
          name: t.name,
          slug: t.slug,
          url: t.url,
          count: t.count,
          posts: t.posts.map(cardOf),
        },
      };
      out['tags/' + t.slug + '/index.html'] = renderTemplate(parsed.get('tag'), root, parsed);
    }
  }

  if (parsed.has('tags')) {
    const root = { site: siteObj, tags: tagObjs, recent: recentCards };
    out['tags/index.html'] = renderTemplate(parsed.get('tags'), root, parsed);
  }

  const builtPaths = new Set(Object.keys(out));
  for (const f of statics) {
    if (builtPaths.has(f.path)) {
      report.push('shadowed ' + f.path + ': a built page has its path');
      continue;
    }
    out[f.path] = f.content;
  }

  for (const line of broken) {
    const sep = line.indexOf('\n');
    report.push('broken-link ' + line.slice(0, sep) + ' -> ' + line.slice(sep + 1));
  }
  report.sort();
  const pageCount = pages.length - posts.length;
  report.push('built ' + pageCount + ' pages, ' + posts.length + ' posts, ' + tags.length +
    ' tags and ' + statics.length + ' static files');
  out['build-report.txt'] = report.join('\n') + '\n';
  return out;
}

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}
