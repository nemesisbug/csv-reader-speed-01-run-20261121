// A faster drop-in for make.fun's own csv-reader 1.0.0: run(input) returns exactly csv-reader's
// {columns, rows, errors} for every input {text, header}, but reads the text with native indexOf scans
// and whole-field slices instead of one character at a time.
//
// Semantics (csv-reader 1.0.0, as its tree ships it):
// - a U+FEFF at the very start is dropped;
// - a record ends at LF or CRLF, and a line left with no characters is no record;
// - outside quotes a CR not followed by LF is dropped (error stray_cr);
// - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one quote
//   and each CRLF or lone CR inside it read as LF; what follows its closing quote, up to the next comma
//   or line break, is appended as it stands (quote_junk, when the field ends); a quote that never closes
//   is a literal character, and the text after it is read again as unquoted (unterminated_quote);
// - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed;
// - columns is the first record when header is true, else null; rows holds the records after it, each
//   padded with "" (short_row, with fields: its count) or cut (long_row, with extra: the cut fields) to
//   the first record's width;
// - each error is {code, line, row}, in the order met; line the 1-based line its record starts on,
//   counting every LF, CRLF and lone CR inside quotes, row its record's index in rows, null for the header.
//
// Speed: an unquoted field is found by one native indexOf scan (next comma) against the record's
// next LF, carried along as nextLF instead of re-scanned per field, and taken as one slice; a stray
// CR inside it is the rare slow path. A record with no quote and no stray CR at all is taken as one
// slice and split(',') natively. A quoted field is found by indexOf('"') scans, its segments sliced
// whole; only segments holding a CR or LF pay a conversion pass. Pure: no clock, no randomness, no
// locale, nothing kept from one call to the next.

const CR = 13; // '\r'
const LF = 10; // '\n'
const COMMA = 44; // ','
const QUOTE = 34; // '"'
const BOM = 0xfeff;

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const ENDED_COMMA = 0;
const ENDED_BREAK = 1;
const ENDED_END = 2;

/** CRLF and lone CR, each one LF (inside quotes). */
const CRLF_RE = /\r\n?/g;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === BOM ? 1 : 0;
  let line = 1; // the line the character at pos is on

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The first LF at or after pos, kept valid at each field's start in the slow-path loop: the
  // record's next LF, found once per record instead of once per unquoted field. It stays valid
  // across an unquoted field that ends at a comma (the comma sits before it); after a quoted field
  // it is re-found only when the field ran past it (a quoted field spanning line breaks). -1 when
  // no LF is left in the text.
  let nextLF = -1;

  // Line breaks inside the quoted field being read (added to line only when it closes; a quote that
  // never closes discards them, as csv-reader resets the line when it re-reads the field unquoted).
  let quotedBreaks = 0;

  // A segment of a quoted field, with each CRLF or lone CR read as LF; counts its line breaks.
  function convertSegment(seg) {
    if (seg.indexOf('\r') === -1) {
      let count = 0;
      let i = seg.indexOf('\n');
      while (i !== -1) {
        count += 1;
        i = seg.indexOf('\n', i + 1);
      }
      quotedBreaks += count;
      return seg;
    }
    const conv = seg.replace(CRLF_RE, '\n');
    let count = 0;
    let i = conv.indexOf('\n');
    while (i !== -1) {
      count += 1;
      i = conv.indexOf('\n', i + 1);
    }
    quotedBreaks += count;
    return conv;
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF
  // is dropped (stray_cr). Returns the field, how it ended and how many characters were kept.
  function readUnquoted(value) {
    let added = 0;
    const c = text.indexOf(',', pos);
    const l = nextLF; // the record's next LF, carried along (see nextLF above)
    let m;
    let isLF;
    if (c === -1) {
      m = l;
      isLF = true;
    } else if (l === -1) {
      m = c;
      isLF = false;
    } else if (c < l) {
      m = c;
      isLF = false;
    } else {
      m = l;
      isLF = true;
    }
    // The field's characters run to m (or to the end of the text); a CR just before that LF is the
    // CRLF's own, every other CR in the run is stray: no CR in the run can be followed by LF, else
    // that LF would be the m found above.
    let end = m === -1 ? n : m;
    if (isLF && m > pos && text.charCodeAt(m - 1) === CR) end = m - 1;
    const seg = text.slice(pos, end);
    const r = seg.indexOf('\r');
    if (r === -1) {
      value += seg;
      added += seg.length;
    } else {
      // Stray CRs, one error each, dropped from the field.
      let s = 0;
      for (let i = r; i < seg.length; i += 1) {
        if (seg.charCodeAt(i) === CR) {
          if (i > s) {
            value += seg.slice(s, i);
            added += i - s;
          }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          s = i + 1;
        }
      }
      if (s < seg.length) {
        value += seg.slice(s);
        added += seg.length - s;
      }
    }
    if (m === -1) {
      pos = n;
      return { value, ended: ENDED_END, added };
    }
    if (isLF) {
      pos = m + 1;
      line += 1;
      return { value, ended: ENDED_BREAK, added };
    }
    pos = m + 1;
    return { value, ended: ENDED_COMMA, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let start = pos + 1;
    let value = '';
    quotedBreaks = 0;
    let q = text.indexOf('"', start);
    while (q !== -1 && text.charCodeAt(q + 1) === QUOTE) {
      value += convertSegment(text.slice(start, q));
      value += '"';
      start = q + 2;
      q = text.indexOf('"', start);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    value += convertSegment(text.slice(start, q));
    line += quotedBreaks;
    pos = q + 1;
    if (pos >= n) return { value, ended: ENDED_END, added: 0 };
    const ch = text.charCodeAt(pos);
    if (ch === COMMA) {
      pos += 1;
      return { value, ended: ENDED_COMMA, added: 0 };
    }
    if (ch === LF) {
      pos += 1;
      line += 1;
      return { value, ended: ENDED_BREAK, added: 0 };
    }
    if (ch === CR && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line += 1;
      return { value, ended: ENDED_BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    // The quoted field may have run past nextLF (line breaks inside it), so re-find it first.
    if (nextLF !== -1 && pos > nextLF) nextLF = text.indexOf('\n', pos);
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // Finishes a record's fields: the header, or a row padded or cut to the first record's width.
  function finishRecord(fields, quoted) {
    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const ch = text.charCodeAt(pos);
      if (ch === LF) {
        pos += 1;
        line += 1;
      } else if (ch === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record to its next LF holds no quote and no stray CR, so it is one slice split
    // on commas. A '"' anywhere in it, or a CR that is not the CRLF's own, falls back to the field
    // reader (the LF may sit inside a quoted field, or a quote may open one that never closes).
    // The quote/CR checks run on the record's own slice, so no scan runs past the record.
    const lf = text.indexOf('\n', pos);
    const segEnd = lf === -1 ? n : lf;
    let fastEnd = segEnd;
    if (lf !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === CR) fastEnd = segEnd - 1;
    const seg = text.slice(pos, fastEnd);
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      const fields = seg.split(',');
      finishRecord(fields, false);
      pos = lf === -1 ? n : lf + 1;
      if (lf !== -1) line += 1;
      continue;
    }

    nextLF = lf;
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === QUOTE;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
      // A quoted field that ended at a comma may have run past nextLF (line breaks inside it).
      if (quoted && field.ended === ENDED_COMMA && nextLF !== -1 && pos > nextLF) {
        nextLF = text.indexOf('\n', pos);
      }
    } while (field.ended === ENDED_COMMA);
    finishRecord(fields, quoted);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
