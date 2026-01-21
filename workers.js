// Cloudflare Worker Script (worker.js)
// Updated: 2025-04-07 (Reverted to root proxy + Token Auth)

// ================== CONFIGURATION ==================
const UPSTREAM_HOST = 'github.com';
const RAW_UPSTREAM_HOST = 'raw.githubusercontent.com';
const RAW_PROXY_PREFIX = '/raw-content';

// Authentication Configuration
const DEFAULT_PROXY_PASSWORD = 'iloveyou'; // CHANGE THIS if using manual deployment
const AUTH_COOKIE_NAME = '__gh_proxy_auth';
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 Days

const BLOCKED_PATHS = [
  '/login', '/session', '/sessions', '/join', '/signup',
  '/password_reset', '/settings', '/account', '/new'
];

const WARNING_BANNER_HTML = `
<div style="background-color: #fffbe6; color: #333; padding: 12px 20px; border-bottom: 1px solid #f5e79e; text-align: center; font-size: 14px; font-family: sans-serif; z-index: 99999; line-height: 1.5;">
  <strong>Note:</strong> Non-official GitHub proxy for testing/acceleration. Do NOT login or use sensitive data. <a href="https://github.com" target="_blank" style="color: #0056b3; font-weight: bold;">github.com</a>
</div>
`;
const TITLE_PREFIX = "[Proxy] ";

const LOGIN_PAGE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Proxy Authorization</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f6f8fa; margin: 0; }
        .login-box { background: white; padding: 2rem; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); width: 300px; text-align: center; }
        input { width: 100%; padding: 8px; margin-bottom: 10px; border: 1px solid #d0d7de; border-radius: 4px; box-sizing: border-box; }
        button { width: 100%; padding: 8px; background-color: #2da44e; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; }
        button:hover { background-color: #2c974b; }
        .error { color: #cf222e; font-size: 14px; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="login-box">
        <h3>Proxy Authorization</h3>
        <p>Please enter the access token/password.</p>
        <form method="POST" action="/login-proxy">
            <input type="password" name="password" placeholder="Password" required autofocus>
            <button type="submit">Access</button>
        </form>
    </div>
</body>
</html>
`;
// ================== END CONFIGURATION ==================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Fix: Handle Git appending path to token param (e.g. ?token=pw/info/refs)
    let tokenParam = url.searchParams.get('token');
    if (tokenParam && tokenParam.includes('/')) {
      const splitIndex = tokenParam.indexOf('/');
      const realToken = tokenParam.substring(0, splitIndex);
      const extraPath = tokenParam.substring(splitIndex);

      url.searchParams.set('token', realToken);
      url.pathname += extraPath;
    }

    const { pathname } = url;
    const workerOrigin = url.origin;
    const PROXY_PASSWORD = env.PROXY_PASSWORD || DEFAULT_PROXY_PASSWORD;

    // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') return handleOptions(request, workerOrigin);

    // 2. Authentication Check & Token Handling
    const token = url.searchParams.get('token');
    const isTokenValid = token === PROXY_PASSWORD;
    const userAgent = request.headers.get('User-Agent') || '';
    // Git clients usually send 'git/x.y.z'. Also check for .git path or standard git services.
    const isGitClient = userAgent.startsWith('git/') || pathname.endsWith('.git') || pathname.includes('/info/refs') || pathname.includes('/git-upload-pack');

    // Basic Auth Support (Authorization: Basic base64(user:password))
    const authHeader = request.headers.get('Authorization');
    let isBasicAuth = false;
    if (authHeader && authHeader.startsWith('Basic ')) {
      try {
        const base64 = authHeader.substring(6);
        const decoded = atob(base64); // user:password
        const separator = decoded.indexOf(':');
        if (separator !== -1) {
          const password = decoded.substring(separator + 1);
          if (password === PROXY_PASSWORD) {
            isBasicAuth = true;
          }
        }
      } catch (e) { }
    }

    // Handle Login via URL Token (?token=PASSWORD)
    // Behavior: Redirect browsers to clean URL, but allow Git clients to pass through with token.
    if (isTokenValid && !isGitClient && !isBasicAuth) {
      // Set cookie and redirect to clean URL
      url.searchParams.delete('token');
      const newUrl = url.toString();
      return new Response(null, {
        status: 302,
        headers: {
          'Location': newUrl,
          'Set-Cookie': `${AUTH_COOKIE_NAME}=${PROXY_PASSWORD}; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE}; Secure; HttpOnly; SameSite=Lax`
        }
      });
    }

    const cookieHeader = request.headers.get('Cookie') || '';
    const cookies = parseCookies(cookieHeader);
    const isCookieAuth = cookies[AUTH_COOKIE_NAME] === PROXY_PASSWORD;

    // Authenticated if: Valid Cookie OR (Git Client + Valid Token) OR Basic Auth
    const isAuth = isCookieAuth || (isTokenValid && isGitClient) || isBasicAuth;

    // Remove token from URL if valid, so we don't upstream it to GitHub (cleaner)
    if (isTokenValid && isAuth) {
      url.searchParams.delete('token');
    }

    // Handle POST Login
    if (pathname === '/login-proxy' && request.method === 'POST') {
      const formData = await request.formData();
      const password = formData.get('password');
      if (password === PROXY_PASSWORD) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': '/',
            'Set-Cookie': `${AUTH_COOKIE_NAME}=${PROXY_PASSWORD}; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE}; Secure; HttpOnly; SameSite=Lax`
          }
        });
      } else {
        return new Response("Invalid Password", { status: 403 });
      }
    }

    // Block if not authenticated
    if (!isAuth) {
      // If it looks like a Git client or Basic Auth attempt, send WWW-Authenticate
      if (isGitClient || authHeader) {
        return new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="GitHub Proxy"' }
        });
      }

      return new Response(LOGIN_PAGE_HTML, {
        status: 401,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // --- LOGIC BELOW THIS POINT IS ONLY REACHABLE IF AUTHENTICATED ---

    // 3. Raw Content Proxy
    if (pathname.startsWith(RAW_PROXY_PREFIX + '/')) {
      const rawPath = pathname.substring(RAW_PROXY_PREFIX.length);
      const rawUpstreamUrl = `https://${RAW_UPSTREAM_HOST}${rawPath}${url.search}`;

      const rawRequestHeaders = new Headers(request.headers);
      rawRequestHeaders.set('Host', RAW_UPSTREAM_HOST);
      ['cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor'].forEach(h => rawRequestHeaders.delete(h));

      try {
        const rawResponse = await fetch(rawUpstreamUrl, {
          method: request.method,
          headers: rawRequestHeaders,
          body: request.body,
          redirect: 'follow'
        });
        const newHeaders = new Headers(rawResponse.headers);
        addCorsHeaders(newHeaders, workerOrigin);
        return new Response(rawResponse.body, {
          status: rawResponse.status,
          statusText: rawResponse.statusText,
          headers: newHeaders
        });
      } catch (e) {
        return new Response('Raw fetch failed', { status: 502 });
      }
    }

    // 4. Main Site Proxy (Root Path)
    // Block sensitive paths
    let isBlocked = BLOCKED_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
    if (!isBlocked && pathname.startsWith('/settings/')) isBlocked = true;
    if (isBlocked) {
      return new Response(`Path ${pathname} is blocked.`, { status: 403 });
    }

    const upstreamUrl = `https://${UPSTREAM_HOST}${pathname}${url.search}`;
    const reqHeaders = new Headers(request.headers);
    reqHeaders.set('Host', UPSTREAM_HOST);
    ['cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor'].forEach(h => reqHeaders.delete(h));

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers: reqHeaders,
        body: request.body,
        redirect: 'manual'
      });

      const resHeaders = new Headers(upstreamResponse.headers);
      // Handle Redirects
      if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
        const loc = resHeaders.get('Location');
        if (loc) {
          try {
            const absLoc = new URL(loc, upstreamUrl).toString();
            // Simple replacement since we are on root path now
            let newLoc = absLoc.replaceAll(`https://${UPSTREAM_HOST}`, workerOrigin);
            newLoc = newLoc.replaceAll(`https://${RAW_UPSTREAM_HOST}`, `${workerOrigin}${RAW_PROXY_PREFIX}`);
            resHeaders.set('Location', newLoc);
          } catch (e) { }
        }
        addCorsHeaders(resHeaders, workerOrigin);
        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          headers: resHeaders
        });
      }

      // Handle Content
      resHeaders.delete('Content-Security-Policy');
      resHeaders.delete('Content-Security-Policy-Report-Only');
      addCorsHeaders(resHeaders, workerOrigin);

      const contentType = resHeaders.get('Content-Type');
      let body = upstreamResponse.body;

      if (contentType && (contentType.includes('text/html') || contentType.includes('javascript'))) {
        let text = await upstreamResponse.text();
        let modified = false;

        // Robust URL replacement (handles https:// and https:\/\/ for JSON)
        const generateReplacement = (match, prefix, upstream, replacement) => {
          if (prefix === '\\/\\/') {
            return replacement.replace('://', ':\\/\\/');
          }
          return replacement;
        };

        const upstreamRegex = new RegExp(`https:(//|\\\\/\\\\/)${UPSTREAM_HOST}`, 'g');
        if (upstreamRegex.test(text)) {
          text = text.replace(upstreamRegex, (match, prefix) =>
            generateReplacement(match, prefix, UPSTREAM_HOST, workerOrigin)
          );
          modified = true;
        }

        const rawRegex = new RegExp(`https:(//|\\\\/\\\\/)${RAW_UPSTREAM_HOST}`, 'g');
        if (rawRegex.test(text)) {
          text = text.replace(rawRegex, (match, prefix) =>
            generateReplacement(match, prefix, RAW_UPSTREAM_HOST, `${workerOrigin}${RAW_PROXY_PREFIX}`)
          );
          modified = true;
        }

        // Inject Banner & Title for HTML
        if (contentType.includes('text/html')) {
          const titleRegex = /<title>(.*?)<\/title>/is;
          text = text.replace(titleRegex, `<title>${TITLE_PREFIX}$1</title>`);
          const bodyTag = /<body[^>]*>/i;
          if (bodyTag.test(text)) {
            text = text.replace(bodyTag, `$&${WARNING_BANNER_HTML}`);
            modified = true;
          }
        }

        if (modified) {
          body = text;
          resHeaders.delete('Content-Length');
        } else {
          body = text; // If we read text, we must return text strings/bytes, not the used stream
        }
      }

      return new Response(body, {
        status: upstreamResponse.status,
        headers: resHeaders
      });

    } catch (e) {
      return new Response('Upstream fetch failed', { status: 502 });
    }
  }
};

function handleOptions(request, workerOrigin) {
  const headers = request.headers;
  if (headers.get('Origin')) {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': workerOrigin,
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': headers.get('Access-Control-Request-Headers') || '*',
        'Access-Control-Max-Age': '86400'
      }
    });
  }
  return new Response(null, { status: 200, headers: { Allow: 'GET, HEAD, POST, OPTIONS' } });
}

function addCorsHeaders(headers, workerOrigin) {
  headers.set('Access-Control-Allow-Origin', workerOrigin);
  headers.set('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,DELETE,OPTIONS');
  headers.set('Access-Control-Allow-Headers', '*');
  headers.set('Access-Control-Allow-Credentials', 'true');
}

function parseCookies(header) {
  const list = {};
  if (!header) return list;
  header.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
}
