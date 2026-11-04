/** Single-line text: control characters and runs of space become one space, cut to `max`. */
export function cleanText(s: string, max: number): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
