/* An icon made from a name, for anything with no picture of its own (a client, a server card). Shared by add-to-ai and the cards. */

/*
 * An icon made from the name, for a client with none on the CDN (or one that cannot load): its initials
 * (two words give two letters) on a color that comes from the name, so each client keeps the same one.
 */
export function initialsOf(label) {
  const words = String(label || '?').replace(/\(.*?\)/g, ' ').split(/[\s-]+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase().replace(/^(.)(.)$/, (m, a, b) => (words.length > 1 ? a + b : a + b.toLowerCase()))
}
export function hueOf(label) {
  let h = 0
  for (const ch of String(label)) h = (h * 31 + ch.codePointAt(0)) % 360
  return h
}
