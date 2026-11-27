/* The debugger's own styles. It stands alone, outside the inspector too, so it carries its own fallbacks. Colors follow --mcpi-* when the page sets them. */
const CSS = `.mcpi-dbg,.mcpi-dbg-notice{--d-ink:var(--mcpi-ink,#16181d);--d-mute:var(--mcpi-mute,#666c76);--d-rule:var(--mcpi-rule,#d3d6dc);--d-card:var(--mcpi-card,#fff);--d-tint:var(--mcpi-tint,#eceef2);--d-ok:var(--mcpi-accent3,#2e7d4f);--d-bad:var(--mcpi-accent2,#c8102e);--d-warn:#a15c00;--d-mono:var(--mcpi-mono,ui-monospace,'SF Mono',Consolas,monospace)}
@media (prefers-color-scheme:dark){.mcpi-dbg,.mcpi-dbg-notice{--d-ink:var(--mcpi-ink,#eceef2);--d-mute:var(--mcpi-mute,#9a9fa8);--d-rule:var(--mcpi-rule,#3a3e46);--d-card:var(--mcpi-card,#1c1e22);--d-tint:var(--mcpi-tint,#2a2d33);--d-ok:var(--mcpi-accent3,#78c79a);--d-bad:var(--mcpi-accent2,#ff7a85);--d-warn:#f0b35a}}
.mcpi-dbg{display:grid;gap:.6rem;color:var(--d-ink);font-family:var(--mcpi-sans,system-ui,-apple-system,'Segoe UI',sans-serif);font-size:.82rem;min-width:0}
.mcpi-dbg button{font:inherit;color:inherit;cursor:pointer}
.mcpi-dbg pre{margin:0;font-family:var(--d-mono);font-size:.72rem;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.mcpi-dbg .is-ok{color:var(--d-ok)}.mcpi-dbg .is-fail{color:var(--d-bad)}.mcpi-dbg .is-warn{color:var(--d-warn)}.mcpi-dbg .is-info,.mcpi-dbg .is-skip,.mcpi-dbg .is-none,.mcpi-dbg .is-busy{color:var(--d-mute)}
.mcpi-dbg-flow{border:1px solid var(--d-rule);border-radius:8px;padding:.1rem .8rem}
.mcpi-dbg-flow.is-fail{border-color:var(--d-bad)}
.mcpi-dbg-flow>summary{cursor:pointer;min-height:40px;display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .5rem;font-weight:700}
.mcpi-dbg-flow>summary small{font-weight:400}
.mcpi-dbg-strip{display:flex;flex-wrap:wrap;gap:.15rem .35rem;align-items:center;font-size:.74rem;font-weight:400;width:100%;padding-bottom:.4rem}
.mcpi-dbg-strip span{display:inline-flex;align-items:center;gap:.15rem;white-space:nowrap}
.mcpi-dbg-strip i{font-style:normal;color:var(--d-mute)}
.mcpi-dbg-steps{list-style:none;margin:0 0 .5rem;padding:0;display:grid}
.mcpi-dbg-steps li{display:grid;grid-template-columns:1.2rem minmax(0,1fr);gap:.1rem .5rem;padding:.35rem 0;border-top:1px solid var(--d-rule)}
.mcpi-dbg-steps button{all:unset;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.mcpi-dbg-steps p{grid-column:2;margin:0;font-size:.76rem}
.mcpi-dbg-bar{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;justify-content:space-between}
.mcpi-dbg-pills{display:flex;flex-wrap:wrap;gap:.3rem}
.mcpi-dbg-pill{min-height:30px;padding:0 .7rem;border:1px solid var(--d-rule);border-radius:999px;background:var(--d-card);font-size:.76rem!important}
.mcpi-dbg-pill[aria-pressed=true]{background:var(--d-tint);border-color:var(--d-ink);font-weight:700}
.mcpi-dbg-copy{width:34px;height:34px;padding:0;display:grid;place-items:center;border:1px solid var(--d-rule);border-radius:999px;background:var(--d-card)}
.mcpi-dbg-copy.is-done{color:var(--d-ok);border-color:var(--d-ok)}
.mcpi-dbg-check{display:inline-flex;gap:.35rem;align-items:center;font-size:.76rem;color:var(--d-mute)}
.mcpi-dbg-note{margin:0;font-size:.74rem;color:var(--d-mute)}
.mcpi-dbg-rows{display:grid}
.mcpi-dbg-row{border-bottom:1px solid var(--d-rule)}
.mcpi-dbg-row>summary{cursor:pointer;min-height:40px;display:grid;grid-template-columns:1.2rem minmax(0,1fr) auto 4.6rem;gap:.5rem;align-items:center;font-size:.76rem;color:var(--d-mute);list-style:none}
.mcpi-dbg-row>summary::-webkit-details-marker{display:none}
.mcpi-dbg-row>summary code{font-family:var(--d-mono);color:var(--d-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mcpi-dbg-row>summary span:last-child{text-align:right}
.mcpi-dbg-row.is-fail>summary code{color:var(--d-bad)}
.mcpi-dbg-row.is-hit{outline:2px solid var(--d-bad);outline-offset:-2px;border-radius:6px}
.mcpi-dbg-hint{margin:.1rem 0 .5rem 1.7rem;font-size:.76rem}
.mcpi-dbg-part{margin:0 0 .6rem 1.7rem}
.mcpi-dbg-part h4{margin:.2rem 0;font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;color:var(--d-mute)}
.mcpi-dbg-part pre{padding:.5rem .7rem;background:var(--d-tint);border-radius:6px;max-height:18rem;overflow:auto}
.mcpi-dbg-log{padding:.6rem .7rem;background:var(--d-tint);border-radius:6px;max-height:32rem;overflow:auto}
.mcpi-dbg-empty{margin:0;padding:1rem 0;color:var(--d-mute)}
.mcpi-dbg-notice{display:flex;flex-wrap:wrap;gap:.5rem .8rem;align-items:center;padding:.6rem .8rem;border:1px solid var(--d-bad);border-radius:8px;color:var(--d-bad);font-size:.82rem}
.mcpi-dbg-notice[hidden]{display:none}
.mcpi-dbg-notice p{flex:1;min-width:12rem;margin:0}
.mcpi-dbg-notice b{display:block}
.mcpi-dbg-notice button{display:inline-flex;align-items:center;gap:.35rem;min-height:36px;padding:0 .8rem;border:1px solid var(--d-rule);border-radius:999px;background:var(--d-card);color:var(--d-ink);font:inherit;font-size:.78rem;font-weight:700;cursor:pointer}
`

let added = false
/** Adds the styles to the page once. */
export function addStyle(doc = document) {
  if (added || doc.querySelector('style[data-mcpi-debug]')) { added = true; return }
  const s = doc.createElement('style')
  s.setAttribute('data-mcpi-debug', '')
  s.textContent = CSS
  doc.head.append(s)
  added = true
}
