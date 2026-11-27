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
  /* The debugger's marks: a cross for a failure, a dot for what was expected along the way, a dashed ring for a step not reached. */
  cross: ['M7 7l10 10', 'M17 7L7 17'],
  dot: ['M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4'],
  ring: ['M12 4a8 8 0 0 1 3 .6', 'M19.4 9a8 8 0 0 1 0 6', 'M15 19.4a8 8 0 0 1-6 0', 'M4.6 15a8 8 0 0 1 0-6', 'M9 4.6A8 8 0 0 1 12 4'],
  warn: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17v.5'],
  bug: ['M9 8V6a3 3 0 0 1 6 0v2', 'M7 9h10v5a5 5 0 0 1-10 0V9z', 'M12 13v6', 'M3 13h4', 'M17 13h4', 'M4 8l3 2', 'M20 8l-3 2', 'M4 19l3-2', 'M20 19l-3-2'],
  arrowOut: ['M7 17L17 7', 'M9 7h8v8'],
  arrowIn: ['M17 7L7 17', 'M15 17H7V9'],
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

