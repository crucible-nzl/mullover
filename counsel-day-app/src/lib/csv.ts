/**
 * CSV builder · RFC 4180 compliant.
 *
 * `toCsv(headers, rows)` produces a string ready to write to a Response
 * with content-type text/csv. Handles:
 *   · field escaping (quotes doubled, fields with commas / newlines /
 *     quotes wrapped in quotes)
 *   · null → empty cell
 *   · Date → ISO 8601 (UTC)
 *   · boolean → 'true' / 'false'
 *   · number → JSON.stringify (NaN/Infinity become empty)
 *   · everything else → String()
 *
 * Designed for admin exports · not optimised for million-row streams.
 * For those, switch to a streaming writer.
 */

function escapeField(v: unknown): string {
  if (v == null) return '';
  let s: string;
  if (v instanceof Date) {
    s = isNaN(v.getTime()) ? '' : v.toISOString();
  } else if (typeof v === 'boolean') {
    s = v ? 'true' : 'false';
  } else if (typeof v === 'number') {
    s = Number.isFinite(v) ? String(v) : '';
  } else if (typeof v === 'object') {
    // jsonb / array · serialise compact JSON so the receiving spreadsheet
    // gets the structure verbatim. Long lines are inevitable but OK.
    s = JSON.stringify(v);
  } else {
    s = String(v);
  }
  // Quote if the field contains a comma, double-quote, CR, or LF.
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const out: string[] = [];
  out.push(headers.map(escapeField).join(','));
  for (const row of rows) {
    out.push(headers.map((h) => escapeField(row[h])).join(','));
  }
  return out.join('\r\n') + '\r\n';
}
