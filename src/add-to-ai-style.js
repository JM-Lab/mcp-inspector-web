/* The component's own styles. It stands alone, outside the inspector too, so it carries its own fallbacks. */
const CSS = `.mcpi-addto,.mcpi-addto-trigger{--a-ink:var(--mcpi-ink,#16181d);--a-mute:var(--mcpi-mute,#666c76);--a-rule:var(--mcpi-rule,#d3d6dc);--a-card:var(--mcpi-card,#fff);--a-tint:var(--mcpi-tint,#eceef2);--a-inv:var(--mcpi-inv,#fff);--a-accent:var(--mcpi-accent,#1f5fbf);--a-warn:var(--mcpi-accent2,#c8102e);--a-mono:var(--mcpi-mono,ui-monospace,'SF Mono',Consolas,monospace)}
@media (prefers-color-scheme:dark){
  .mcpi-addto,.mcpi-addto-trigger{--a-ink:var(--mcpi-ink,#eceef2);--a-mute:var(--mcpi-mute,#9a9fa8);--a-rule:var(--mcpi-rule,#3a3e46);--a-card:var(--mcpi-card,#1c1e22);--a-tint:var(--mcpi-tint,#2a2d33);--a-inv:var(--mcpi-inv,#141518);--a-accent:var(--mcpi-accent,#8ab8ee);--a-warn:var(--mcpi-accent2,#ff7a85)}
}
.mcpi-addto{width:min(42rem,calc(100vw - 2rem));overflow-x:hidden;max-height:calc(100vh - 3rem);box-sizing:border-box;padding:1rem 1.1rem 1.2rem;border:1px solid var(--a-rule);border-radius:12px;background:var(--a-card);color:var(--a-ink);font-family:var(--mcpi-sans,system-ui,-apple-system,'Segoe UI',sans-serif);font-size:.85rem;line-height:1.5}
.mcpi-addto::backdrop{background:rgba(0,0,0,.45)}
.mcpi-addto button,.mcpi-addto a{font:inherit}
.mcpi-addto-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}
.mcpi-addto-head h2{margin:0;font-size:1.05rem;font-weight:800;overflow-wrap:anywhere}
.mcpi-addto-head code{font-family:var(--a-mono);font-size:.74rem;color:var(--a-mute);overflow-wrap:anywhere}
.mcpi-addto-close,.mcpi-addto-copy{flex:none;min-height:36px;padding:0 .8rem;border:1px solid var(--a-rule);border-radius:6px;background:var(--a-card);color:var(--a-ink);font-size:.8rem!important;font-weight:700;cursor:pointer}
.mcpi-addto-label{margin:1rem 0 .4rem;font-weight:800;font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:var(--a-mute)}
.mcpi-addto-tiles{display:grid;gap:.4rem;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))}
.mcpi-addto-search{display:block;width:100%;box-sizing:border-box;min-height:40px;margin:0 0 .6rem;padding:.35rem .7rem;border:1px solid var(--a-rule);border-radius:8px;background:var(--a-card);color:var(--a-ink);font:inherit;font-size:16px}
.mcpi-addto-groups{display:grid;gap:.7rem;max-height:min(46vh,24rem);overflow:auto;padding-right:.15rem}
.mcpi-addto-group[hidden],.mcpi-addto-tile[hidden],.mcpi-addto-hint[hidden]{display:none}
.mcpi-addto-group-name{margin:0 0 .3rem;font-size:.72rem;font-weight:700;color:var(--a-mute)}
.mcpi-addto-tile{display:grid;grid-template-columns:22px minmax(0,1fr);column-gap:.55rem;row-gap:.05rem;align-items:center;text-align:left;min-height:52px;padding:.45rem .7rem;border:1px solid var(--a-rule);border-radius:8px;background:var(--a-card);color:var(--a-ink);cursor:pointer}
.mcpi-addto-tile b{font-size:.85rem;grid-column:2}
.mcpi-addto-tile span:not(.mcpi-addto-ico){grid-column:2}
.mcpi-addto-ico{grid-row:1/3;width:22px;height:22px;display:grid;place-items:center}
.mcpi-addto-ico img{width:22px;height:22px;display:block}
.mcpi-addto-ico.is-mono{background:var(--a-ink)}
.mcpi-addto-ico.is-letter{border-radius:6px;font-size:.62rem!important;font-weight:800;letter-spacing:-.02em;color:#fff!important}
.mcpi-addto-tile span{font-size:.7rem;color:var(--a-mute)}
.mcpi-addto-tile.is-on{border-color:var(--a-ink);box-shadow:inset 0 0 0 1px var(--a-ink)}
.mcpi-addto-detail{margin-top:1rem;padding-top:.9rem;border-top:1px solid var(--a-rule);display:grid;grid-template-columns:minmax(0,1fr);gap:.6rem}
.mcpi-addto-manual[open]{grid-template-columns:minmax(0,1fr)}
.mcpi-addto-detail>p{margin:0}
.mcpi-addto-detail code{font-family:var(--a-mono);font-size:.78rem}
.mcpi-addto-code{display:flex;gap:.4rem;align-items:flex-start}
.mcpi-addto-code pre{flex:1;min-width:0;margin:0;padding:.55rem .7rem;border:1px solid var(--a-rule);border-radius:6px;font-family:var(--a-mono);font-size:.74rem;line-height:1.5;max-height:14rem;overflow:auto;white-space:pre}
.mcpi-addto-go{justify-self:start;display:inline-flex;align-items:center;min-height:44px;padding:0 1.3rem;border-radius:6px;background:var(--a-ink);color:var(--a-inv)!important;font-weight:800;text-decoration:none}
.mcpi-addto-go.is-quiet{min-height:36px;padding:0 .9rem;background:none;border:1px solid var(--a-rule);color:var(--a-ink)!important;font-weight:700;font-size:.8rem}
.mcpi-addto-hint{margin:0;font-size:.76rem;color:var(--a-mute)}
.mcpi-addto-note{margin:0;font-size:.78rem;color:var(--a-warn)}
.mcpi-addto-secret{display:flex;gap:.5rem;align-items:flex-start;margin-top:.8rem;padding:.55rem .7rem;border:1px solid var(--a-rule);border-radius:8px;cursor:pointer}
.mcpi-addto-secret input{margin-top:.2rem}
.mcpi-addto-secret span{display:grid}
.mcpi-addto-secret small{color:var(--a-mute);font-size:.74rem}
.mcpi-addto-ok{margin:.8rem 0 0;padding:.6rem .75rem;border:1px solid var(--mcpi-accent3,#2e7d4f);border-radius:8px;color:var(--mcpi-accent3,#2e7d4f);font-size:.82rem;font-weight:700}
.mcpi-addto-mobile{margin:.8rem 0 0;padding:.6rem .75rem;border-radius:8px;background:var(--a-tint);font-size:.8rem}
.mcpi-addto-away{margin:0;padding:.55rem .7rem;border:1px solid var(--a-warn);border-radius:8px;color:var(--a-warn);font-size:.8rem}
.mcpi-addto-tile.is-away{opacity:.62}
.mcpi-addto-tile.is-away span:not(.mcpi-addto-ico){color:var(--a-warn)}
.mcpi-addto-get{justify-self:start;font-size:.78rem;font-weight:700;color:var(--a-accent)}
.mcpi-addto-away[hidden]{display:none}
.mcpi-addto-away p{margin:0 0 .45rem}
.mcpi-addto-again{color:var(--a-warn)}
.mcpi-addto-row{display:flex;flex-wrap:wrap;gap:.8rem;align-items:center}
.mcpi-addto-go.is-off{opacity:.45;cursor:not-allowed}
.mcpi-addto-steps{margin:0;padding-left:1.3rem;display:grid;gap:.2rem}
.mcpi-addto-manual summary{cursor:pointer;color:var(--a-mute);font-weight:700;font-size:.78rem;min-height:32px;display:flex;align-items:center}
.mcpi-addto-manual[open]{display:grid;gap:.4rem}
.mcpi-addto-trigger{min-height:36px;padding:0 .9rem;border:1px solid var(--a-rule);border-radius:999px;background:var(--a-card);color:var(--a-ink);font:inherit;font-size:.8rem;font-weight:800;cursor:pointer}
.mcpi-addto-trigger:hover{background:var(--a-tint)}
.mcpi-addto-trigger:disabled{opacity:.6;cursor:default}`
export function addStyle() {
  if (typeof document === 'undefined' || document.getElementById('mcpi-addto-style')) return
  document.head.append(Object.assign(document.createElement('style'), { id: 'mcpi-addto-style', textContent: CSS }))
}
