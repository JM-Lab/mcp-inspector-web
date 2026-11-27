# Changelog

Versions follow [semver](https://semver.org). While the version starts with 0, a minor release may change options or exports.

## 0.1.0 (2026-11-27)

The first public release.

### Inspector

- Connects from the browser to remote MCP servers over Streamable HTTP, through the official SDK. No backend and no proxy.
- Speaks protocol revision 2026-07-28 (`server/discover`, no `initialize`, no session, notifications on `subscriptions/listen`) and the 2025 revisions: it asks the server first and falls back to `initialize`. The revision in use is shown next to the server's name: the current one plainly, 2025-11-25 with a note that the earlier way is fine, an older one with what came later. Debug says how it was found. On 2026-07-28, Ping sends `server/discover` and the logging level is not offered, since that revision has neither request.
- Tools, prompts with completion, resources and templates, subscriptions, elicitation, cancelling, Ping, and logging level.
- A Debug tab: every HTTP request with the JSON-RPC messages it carried, as a list or a plain log, with filters and copy. The OAuth sign-in is shown as eight steps, each done or failed with the reason (CORS, an address that does not answer, no dynamic registration, the server's OAuth error). When connecting fails, a notice says where, with **Show in Debug**. Secrets are replaced before anything is recorded.
- OAuth leaves the page only from a button press, also when the SDK would start it again on its own (a refused code, an expired token).
- A header token goes only to the MCP server's own address, never with the OAuth requests to an authorization server.
- A header token is kept for the tab only (sessionStorage), no longer in localStorage: the server stays listed with its header name and asks for the token again. One saved by an earlier version is taken out on the next visit. The field shows dots until its eye is pressed, and an **i** says how long the token is kept.
- On return from OAuth, the code is exchanged only with the authorization server found before leaving (SEP-2352), kept for the round trip like the PKCE verifier.
- Header tokens and OAuth 2.1 with PKCE (dynamic client registration, or a client ID metadata document).
- Search of the official MCP Registry, with deprecated entries left out, and a featured list (`featured.json`).
- Servers you add or open are kept in this browser.
- English and Korean text (`lang`, `ui`).
- `mount()` returns `{ destroy() }`.
- A server that needs sign-in shows **Sign-in needed**, not **Failed**.
- `<mcp-inspector>`: the inspector as an HTML element (`defineInspector()`; the script tag bundle defines it).
- A tool its server marks destructive runs on the second press.
- A link to an address on this computer or a private network waits for a press before connecting (`holdPrivate`).
- Pressing a server card opens the inspector right under that card's row, in the registry list too. One server is always open (`openFirst`).
- Type declarations for `mcp-inspector-web`, `/add-to-ai`, `/debug` and `/lib`.
- `mcp-inspector-web/debug`: the debugger on its own, for any client built on the MCP SDK (`createTrace`, `debugView`, `debugNotice`).

### Links

- Two links to pass on, each with its own sign: the inspector link (flask) opens a server here to try, and the connect link (plug, under each AI client) tests it and goes on to that client.
- Every server card copies a link that opens that server: `?s=`, `?r=` (MCP Registry name) or `?u=` (address), with `&oauth` or `&h=<header name>`. A token never goes into a link.
- `&to=<client>` hands the server on to an AI client once it connects here.

### Add to an AI client

- A component of its own (`mcp-inspector-web/add-to-ai`, or `dist/mcp-add-to-ai.js` with `<mcp-add-to-ai>`), by MCP Registry name or by address.
- 44 clients with a search box. The ones with a one-click install link lead the list, and pressing one starts adding at once; the rest give a command, a config file, or the steps in their settings.
- Says where to check, in the client, that the server is connected.
- A one-click client is added by pressing its tile; under it, icon buttons try the link again, go to the client's site, and copy one link to pass on: the page's own (`shareLink`) or else the install link.
- The server address, for adding it by hand in any client, is always shown under the picked client.
- Carries the token of a server you set up, with a checkbox to take it out for sharing.
- Says on a phone or tablet which clients need a computer.
- When a one-click link opens nothing, says to open the app and try again, and where to get it.
- Keyboard: arrow keys move through the clients, and focus returns to the button that opened the popup.

### Command line

- `npx mcp-inspector-web` serves the same page on localhost (`--port`, `--no-open`).
