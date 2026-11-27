/*
 * Line icons, all drawn the same way (2px strokes on a 24 grid) so they follow the text color.
 * Shared by the inspector and the debugger (debug.js), which stands alone: this file imports nothing.
 */
const ICON_PATHS = {
  link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
  /* Add to AI: a spark (the usual sign for AI) with a small plus. */
  ai: ['M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z', 'M19 15v5', 'M16.5 17.5h5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  /* The two links to pass on, each with its own sign: a flask for the inspector link (open it and try), a plug with a spark for the connect link. */
  flask: ['M9 3h6', 'M10 3v6l-5.2 9a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9V3', 'M7.5 15h9'],
  plug: ['M9 2v5', 'M15 2v5', 'M6 7h12v4a6 6 0 0 1-12 0V7z', 'M12 17v5', 'M12.8 8.6l-2.2 2.9h2.8l-2.2 2.9'],
  copy: ['M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z', 'M16 5V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  /* Share: a box with an arrow going up out of it, as phones draw it. */
  share: ['M12 15V3', 'M8 7l4-4 4 4', 'M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2'],
  /* A secret field: show it, hide it again, and the i that says how long it is kept. */
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5'],
  eyeOff: ['M4 4l16 16', 'M9.9 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4', 'M6.3 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 3.6-.8', 'M10.2 10.3a2.5 2.5 0 0 0 3.5 3.5'],
  info: ['M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17', 'M12 11v5.5', 'M12 7.6v.4'],
  /* The debugger's marks: a cross for a failure, a dot for what was expected along the way, a dashed ring for a step not reached. */
  cross: ['M7 7l10 10', 'M17 7L7 17'],
  dot: ['M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4'],
  ring: ['M12 4a8 8 0 0 1 3 .6', 'M19.4 9a8 8 0 0 1 0 6', 'M15 19.4a8 8 0 0 1-6 0', 'M4.6 15a8 8 0 0 1 0-6', 'M9 4.6A8 8 0 0 1 12 4'],
  warn: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17v.5'],
  bug: ['M9 8V6a3 3 0 0 1 6 0v2', 'M7 9h10v5a5 5 0 0 1-10 0V9z', 'M12 13v6', 'M3 13h4', 'M17 13h4', 'M4 8l3 2', 'M20 8l-3 2', 'M4 19l3-2', 'M20 19l-3-2'],
  arrowOut: ['M7 17L17 7', 'M9 7h8v8'],
  arrowIn: ['M17 7L7 17', 'M15 17H7V9'],
  /* Action buttons: each says what pressing it does. */
  plus: ['M12 5v14', 'M5 12h14'],
  /* The tabs: tools (a wrench), prompts (a speech bubble), resources (a page). Debug uses the bug. */
  tool: ['M14.5 6.5a4 4 0 0 0 5 5l-8.8 8.8a2.1 2.1 0 0 1-3-3l8.8-8.8a4 4 0 0 0-2-2z', 'M14.5 6.5l2.5-2.5'],
  chat: ['M4 5h16v11H9l-5 4z', 'M8 9.5h8', 'M8 12.5h5'],
  page: ['M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M14 3v4h4', 'M8.5 12h7', 'M8.5 15.5h7'],
  refresh: ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v4.5h-4.5'],
  pulse: ['M3 12h4l2.5-6 5 12 2.5-6h4'],
  key: ['M8 11.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7', 'M10.5 13L20 3.5', 'M17 6.5l2.5 2.5', 'M14.5 9l2 2'],
  save: ['M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4z', 'M8 4v5h7V4', 'M8 20v-6h8v6'],
  play: ['M8 5.5v13l10.5-6.5z'],
  stop: ['M7 7h10v10H7z'],
  book: ['M3 5.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H3z', 'M21 5.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H21z'],
  bell: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
  bellOff: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0', 'M4 4l16 16'],
  braces: ['M9 4H8a2 2 0 0 0-2 2v3.5a2 2 0 0 1-2 2.5 2 2 0 0 1 2 2.5V18a2 2 0 0 0 2 2h1', 'M15 4h1a2 2 0 0 1 2 2v3.5a2 2 0 0 0 2 2.5 2 2 0 0 0-2 2.5V18a2 2 0 0 1-2 2h-1'],
  down: ['M6 9l6 6 6-6'],
  ban: ['M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17', 'M6 6l12 12'],
}
export function lineIcon(name, size = 16) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('aria-hidden', 'true')
  for (const d of ICON_PATHS[name]) {
    const p = document.createElementNS(ns, 'path')
    p.setAttribute('d', d)
    p.setAttribute('fill', 'none')
    p.setAttribute('stroke', 'currentColor')
    p.setAttribute('stroke-width', '2')
    p.setAttribute('stroke-linecap', 'round')
    svg.append(p)
  }
  return svg
}

