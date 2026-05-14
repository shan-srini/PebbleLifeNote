const replacer = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;']
]);

export function htmlEscape(s) {
  let out = '';
  for (const ch of s) {
    out += replacer.get(ch) ?? ch;
  }
  return out;
}
