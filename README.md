# MCP Inspector Web

An MCP Inspector that runs entirely in the browser. Connect to a remote MCP server, run its tools, prompts and resources, and read every JSON-RPC message. There is nothing to install and no backend: the browser talks straight to the server through the official TypeScript SDK (`@modelcontextprotocol/client`).

Live demo: [aljal.kr/tools/mcp-inspector](https://aljal.kr/tools/mcp-inspector)

This is not the official [MCP Inspector](https://github.com/modelcontextprotocol/inspector). The official one runs on your own computer (`npx @modelcontextprotocol/inspector`) and can reach local stdio servers. This one is a page you can open or embed, for remote servers.

## What it covers

- Streamable HTTP connection, session and protocol version negotiation
- Tools, Prompts, Resources, resource templates, argument completion, Ping and paging
- Server notifications (list changes, logs, progress), resource subscriptions and cancelling a request
- Input requests from the server (elicitation, form mode)
- Authentication: OAuth 2.1 with PKCE (client metadata document or dynamic client registration), or a header token
- The official [MCP Registry](https://registry.modelcontextprotocol.io): search it, or pick from a prepared "Well known" list
- History: every request and response, with timing

Not covered: sampling and roots are not declared, and stdio servers cannot be reached from a web page. It is an inspector for the standard Model Context Protocol only; WebMCP (`navigator.modelContext`) is a different protocol and is not supported.

### What a server needs to be reachable

A web page can only reach servers that allow it:

- Streamable HTTP over `https` (or `http://localhost`)
- CORS: `Access-Control-Allow-Origin` for the page, and `Access-Control-Expose-Headers: Mcp-Session-Id` so the session survives
- For OAuth, the metadata, registration and token endpoints must allow CORS too

When a server does not, the inspector says which of these failed.

## Use it

### Script tag

```html
<link rel="stylesheet" href="mcp-inspector.css">
<div id="mcpi"></div>
<script>window.MCP_INSPECTOR = { lang: 'en' }</script>
<script src="mcp-inspector.js" defer></script>
```

`npm run build` writes both files to `dist/`.

### As a module

```js
import { mount } from 'mcp-inspector-web'
import 'mcp-inspector-web/style.css'

mount(document.getElementById('inspector'), {
  lang: 'en',
  servers: [{ key: 'mine', name: 'My server', url: 'https://example.com/mcp' }],
})
```

## Options

| Option | Default | |
| --- | --- | --- |
| `lang` | `'en'` | Built-in text: `'en'` or `'ko'`. |
| `ui` | `{}` | Replace any string from `src/strings.js`, for example `{ ours: 'Our servers' }`. |
| `servers` | `[]` | Pinned servers shown first: `{ key, name, url, desc?, icon?, counts?, examples? }`. `examples` are `{ tool, args, label }` chips that fill in a tool's form (`label` is a string or `{ en, ko }`). |
| `featured` | `null` | URL of, or the object of, a `featured.json` (see below). Without it the registry panel shows "Recently updated" and search only. |
| `registry` | official registry | Registry API base, or `false` to hide the registry panel. |
| `storagePrefix` | `'mcpi'` | Prefix of every key kept in localStorage and sessionStorage. |
| `clientInfo` | `{ name: 'mcp-inspector-web', version }` | Sent in `initialize`. |
| `oauth.clientName` | `'MCP Inspector Web'` | `client_name` for dynamic client registration. |
| `oauth.clientMetadataUrl` | `null` | A [client ID metadata document](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) offered as `client_id`. Either a URL, or a map of page origin to URL, since its `redirect_uris` must match the page. |
| `syncUrl` | `true` | Keep `?server=` or `?url=` in the address bar, so a link opens the same server. |
| `root` | `'mcpi'` | Script tag entry only: the id of the element to mount on. |

A page opened with `?url=https://example.com/mcp` adds and opens that server.

### Theme

Styles are scoped under `.mcpi`. Colors and fonts are custom properties (`--mcpi-ink`, `--mcpi-mute`, `--mcpi-rule`, `--mcpi-card`, `--mcpi-accent` and so on, see the top of `src/style.css`). Light and dark defaults are built in, and a host page that already defines `--ink`, `--rule`, `--accent` and the like is followed automatically.

### featured.json

The registry has no popularity order, so "Well known" and "No auth needed" come from a prepared list:

```sh
node scripts/featured.js --out demo/featured.json --origin https://your.site
```

It looks up each name in `FEATURED` in the registry and sends one `initialize` with your origin to see which servers open with no auth.

## Develop

```sh
npm install
npm test        # logic, connection, OAuth against local servers, plus one scenario against a public server
npm run demo    # builds and serves demo/ on http://localhost:8787
```

Set `MCPI_SCENARIO=0` to skip the scenario that reaches a public server.

The code is in three parts: `src/lib.js` (logic with no UI), `src/conn.js` (one connection, UI events go out through hooks) and `src/app.js` (the page). The tests import the first two directly, so they run the same code as the page.

## License

MIT
