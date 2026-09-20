// Pure-JS mirror of crates/th-core/src/entities.rs.
// textContent equivalent: strip markup, decode entities (named table +
// numeric dec/hex with HTML5 U+FFFD rules, legacy semicolon-less names).

const NAMED = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"],
  ['AMP', '&'], ['LT', '<'], ['GT', '>'], ['QUOT', '"'],
  ['nbsp', ' '], ['iexcl', '¡'], ['cent', '¢'], ['pound', '£'],
  ['curren', '¤'], ['yen', '¥'], ['brvbar', '¦'], ['sect', '§'],
  ['uml', '¨'], ['copy', '©'], ['ordf', 'ª'], ['laquo', '«'],
  ['not', '¬'], ['shy', '­'], ['reg', '®'], ['macr', '¯'],
  ['deg', '°'], ['plusmn', '±'], ['sup2', '²'], ['sup3', '³'],
  ['acute', '´'], ['micro', 'µ'], ['para', '¶'], ['middot', '·'],
  ['cedil', '¸'], ['sup1', '¹'], ['ordm', 'º'], ['raquo', '»'],
  ['frac14', '¼'], ['frac12', '½'], ['frac34', '¾'], ['iquest', '¿'],
  ['times', '×'], ['divide', '÷'], ['szlig', 'ß'],
  ['agrave', 'à'], ['aacute', 'á'], ['acirc', 'â'], ['atilde', 'ã'],
  ['auml', 'ä'], ['aring', 'å'], ['aelig', 'æ'], ['ccedil', 'ç'],
  ['egrave', 'è'], ['eacute', 'é'], ['ecirc', 'ê'], ['euml', 'ë'],
  ['igrave', 'ì'], ['iacute', 'í'], ['icirc', 'î'], ['iuml', 'ï'],
  ['ntilde', 'ñ'], ['ograve', 'ò'], ['oacute', 'ó'], ['ocirc', 'ô'],
  ['otilde', 'õ'], ['ouml', 'ö'], ['oslash', 'ø'], ['ugrave', 'ù'],
  ['uacute', 'ú'], ['ucirc', 'û'], ['uuml', 'ü'], ['yacute', 'ý'],
  ['thorn', 'þ'], ['yuml', 'ÿ'],
  ['Agrave', 'À'], ['Aacute', 'Á'], ['Acirc', 'Â'], ['Atilde', 'Ã'],
  ['Auml', 'Ä'], ['Aring', 'Å'], ['AElig', 'Æ'], ['Ccedil', 'Ç'],
  ['Egrave', 'È'], ['Eacute', 'É'], ['Ecirc', 'Ê'], ['Euml', 'Ë'],
  ['Igrave', 'Ì'], ['Iacute', 'Í'], ['Icirc', 'Î'], ['Iuml', 'Ï'],
  ['Ntilde', 'Ñ'], ['Ograve', 'Ò'], ['Oacute', 'Ó'], ['Ocirc', 'Ô'],
  ['Otilde', 'Õ'], ['Ouml', 'Ö'], ['Oslash', 'Ø'], ['Ugrave', 'Ù'],
  ['Uacute', 'Ú'], ['Ucirc', 'Û'], ['Uuml', 'Ü'], ['Yacute', 'Ý'],
  ['THORN', 'Þ'], ['ETH', 'Ð'], ['eth', 'ð'],
  ['hellip', '…'], ['mdash', '—'], ['ndash', '–'], ['lsquo', '‘'],
  ['rsquo', '’'], ['ldquo', '“'], ['rdquo', '”'], ['sbquo', '‚'],
  ['bdquo', '„'], ['dagger', '†'], ['Dagger', '‡'], ['bull', '•'],
  ['permil', '‰'], ['prime', '′'], ['Prime', '″'], ['lsaquo', '‹'],
  ['rsaquo', '›'], ['oline', '‾'], ['frasl', '⁄'], ['euro', '€'],
  ['trade', '™'], ['larr', '←'], ['uarr', '↑'], ['rarr', '→'],
  ['darr', '↓'], ['harr', '↔'], ['minus', '−'], ['lowast', '∗'],
  ['radic', '√'], ['infin', '∞'], ['asymp', '≈'], ['ne', '≠'],
  ['le', '≤'], ['ge', '≥'], ['loz', '◊'], ['spades', '♠'],
  ['clubs', '♣'], ['hearts', '♥'], ['diams', '♦'], ['OElig', 'Œ'],
  ['oelig', 'œ'], ['Scaron', 'Š'], ['scaron', 'š'], ['Yuml', 'Ÿ'],
  ['fnof', 'ƒ'], ['circ', 'ˆ'], ['tilde', '˜'], ['ensp', ' '],
  ['emsp', ' '], ['thinsp', ' '], ['zwnj', '‌'],
  ['zwj', '‍'], ['lrm', '‎'], ['rlm', '‏'],
]);

const LEGACY_NO_SEMI = new Set([
  'amp', 'lt', 'gt', 'quot', 'AMP', 'LT', 'GT', 'QUOT', 'nbsp', 'copy',
  'reg', 'times', 'divide',
]);

function decodeEntity(s, i) {
  // s[i] === '&'. Returns [decoded|null, consumed].
  const len = s.length;
  let j = i + 1;
  if (j >= len) return [null, 1];
  if (s[j] === '#') {
    j += 1;
    const hex = j < len && (s[j] === 'x' || s[j] === 'X');
    if (hex) j += 1;
    const ds = j;
    const re = hex ? /[0-9a-fA-F]/ : /[0-9]/;
    while (j < len && re.test(s[j])) j += 1;
    if (j === ds) return [null, 1];
    let consumed = j - i;
    if (j < len && s[j] === ';') consumed += 1;
    let code = parseInt(s.slice(ds, j), hex ? 16 : 10);
    if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      code = 0xfffd;
    }
    return [String.fromCodePoint(code), consumed];
  }
  const ns = j;
  while (j < len && /[0-9a-zA-Z]/.test(s[j])) j += 1;
  if (j === ns) return [null, 1];
  if (j < len && s[j] === ';') {
    const v = NAMED.get(s.slice(ns, j));
    return v !== undefined ? [v, j - i + 1] : [null, 1];
  }
  // no semicolon: longest legacy prefix
  for (let k = j; k > ns; k--) {
    const name = s.slice(ns, k);
    if (LEGACY_NO_SEMI.has(name)) {
      return [NAMED.get(name), k - i];
    }
  }
  return [null, 1];
}

export function decodeEntities(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '&') {
      const [d, c] = decodeEntity(s, i);
      out += d ?? s[i];
      i += Math.max(c, 1);
    } else {
      out += s[i];
      i += 1;
    }
  }
  return out;
}

export function textContent(s) {
  let out = '';
  let i = 0;
  const len = s.length;
  while (i < len) {
    const ch = s[i];
    if (ch === '<' && i + 1 < len) {
      const n = s[i + 1];
      if (n === '!') {
        if (s.startsWith('<!--', i)) {
          const end = s.indexOf('-->', i + 4);
          if (end === -1) break;
          i = end + 3;
        } else {
          const gt = s.indexOf('>', i);
          i = gt === -1 ? len : gt + 1;
        }
        continue;
      }
      if (n === '?' || n === '/') {
        const gt = s.indexOf('>', i);
        i = gt === -1 ? len : gt + 1;
        continue;
      }
      if (/[a-zA-Z]/.test(n)) {
        i += 1;
        let quote = '';
        while (i < len) {
          const b = s[i];
          if (quote) {
            if (b === quote) quote = '';
          } else if (b === '"' || b === "'") {
            quote = b;
          } else if (b === '>') {
            i += 1;
            break;
          }
          i += 1;
        }
        continue;
      }
      out += '<';
      i += 1;
      continue;
    }
    if (ch === '&') {
      const [d, c] = decodeEntity(s, i);
      out += d ?? s[i];
      i += Math.max(c, 1);
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}
