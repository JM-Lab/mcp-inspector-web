/*
 * OAuth sign-in. The redirect target is this page itself, so there is no separate callback page.
 * Tokens live in sessionStorage and go when the tab closes. The dynamically registered client and the values that
 * only matter during the round trip (which server, the PKCE verifier, the discovered authorization server) live in localStorage: when sign-in ends in a new
 * tab or window (a mail link, an SSO popup) the returning tab must still find them. They are removed on return.
 * The server's OAuth endpoints (metadata, registration, token) must allow browser requests (CORS).
 *
 * Storage and the page location are passed in, so the tests run this with stand-ins.
 *   oauthStore({ prefix, oauth, local, session, page, onRedirect })
 *     local, session   localStorage and sessionStorage
 *     page             location: origin, pathname and assign(url)
 *     onRedirect       (server, url, leaving) just before the page leaves for the authorization page, or when it was not
 *                      allowed to (leaving false); the debugger records it
 *     allowRedirect    (server) → whether the page may leave now. Sign-in starts only from a button press, so the page says yes
 *                      only during a connect the button started. The SDK also asks on its own (a refused code, an expired token):
 *                      then nothing happens, the connect fails, and the button is there to press.
 */
import { clientMetadataFor } from './lib.js'

/** How long a sign-in that left this page is waited for. Past it, a returning code is treated as lost. */
export const PENDING_MAX_MS = 30 * 60000

const jget = (store, k) => { try { return JSON.parse(store.getItem(k)) || undefined } catch (e) { return undefined } }
const jset = (store, k, v) => { try { store.setItem(k, JSON.stringify(v)) } catch (e) { /* storage blocked */ } }
const drop = (store, k) => { try { store.removeItem(k) } catch (e) { /* storage blocked */ } }

export function oauthStore({ prefix, oauth, local, session, page, onRedirect, allowRedirect }) {
  const cfg = Object.assign({ clientName: 'MCP Inspector Web', clientMetadataUrl: null }, oauth)
  const PENDING = prefix + ':oauth'
  const redirectUrl = page.origin + page.pathname
  const key = (name, server) => prefix + ':' + name + ':' + server.url

  /** The authProvider the SDK uses for one server. */
  function provider(server) {
    const k = (name) => key(name, server)
    return {
      get redirectUrl() { return redirectUrl },
      /* A client metadata document offered as client_id (options.oauth.clientMetadataUrl). Servers that accept it skip dynamic registration. Its redirect_uris must match this page, so it is set per origin. */
      get clientMetadataUrl() { return clientMetadataFor(cfg.clientMetadataUrl, page.origin) },
      get clientMetadata() {
        return { client_name: cfg.clientName, client_uri: page.origin, redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }
      },
      clientInformation: () => jget(local, k('client')),
      saveClientInformation: (v) => jset(local, k('client'), v),
      tokens: () => jget(session, k('tokens')),
      saveTokens: (v) => jset(session, k('tokens'), v),
      saveCodeVerifier: (v) => jset(local, k('verifier'), v),
      codeVerifier: () => jget(local, k('verifier')) || jget(session, k('verifier')) || '',
      /*
       * The authorization server found before leaving. On return the SDK checks the code is exchanged with that same server
       * (SEP-2352), and does not look it up again. It lives as long as the verifier.
       */
      saveDiscoveryState: (v) => jset(local, k('discovery'), v),
      discoveryState: () => jget(local, k('discovery')),
      redirectToAuthorization(url) {
        if (allowRedirect && !allowRedirect(server)) {
          if (onRedirect) { try { onRedirect(server, url, false) } catch (e) { /* the debugger must not get in the way */ } }
          return
        }
        jset(local, PENDING, { url: server.url, name: server.name, key: server.key, at: Date.now() })
        if (onRedirect) { try { onRedirect(server, url, true) } catch (e) { /* the debugger must not stop sign-in */ } }
        page.assign(String(url))
      },
    }
  }

  return {
    provider,
    hasTokens: (server) => !!jget(session, key('tokens', server)),
    /** On return from authorization: the sign-in this page started, if it is recent. It is removed, so it is used once. */
    takePending(now = Date.now()) {
      const p = jget(local, PENDING)
      drop(local, PENDING)
      return p && now - (p.at || 0) < PENDING_MAX_MS ? p : null
    },
    /** The PKCE verifier and the discovered authorization server only matter during one round trip. */
    clearVerifier: (server) => { drop(local, key('verifier', server)); drop(local, key('discovery', server)) },
    /** A sign-in starts afresh: the authorization server is looked up again, not taken from one that never came back. */
    startSignIn: (server) => drop(local, key('discovery', server)),
  }
}
