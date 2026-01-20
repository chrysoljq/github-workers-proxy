// Cloudflare Worker 脚本 (worker.js)
// 最后更新时间: 2025-04-07 (基于讨论，添加 raw.githubusercontent.com 代理)

// ================== 配置 ==================
// 目标上游主机 (主 GitHub 站点)
const UPSTREAM_HOST = 'github.com';
// 目标上游主机 (Raw 内容)
const RAW_UPSTREAM_HOST = 'raw.githubusercontent.com';
// 在 Worker 上代理 Raw 内容的路径前缀
const RAW_PROXY_PREFIX = '/raw-content'; // 必须以 / 开头
const MAIN_PROXY_PREFIX = '/github'; // 必须以 / 开头

// 需要屏蔽的主 GitHub 站点路径前缀或完全匹配路径
const BLOCKED_PATHS = [
  '/login',           // 登录页面
  '/session',         // 处理登录请求 (通常是 POST)
  '/sessions',        // 可能的 API 端点或备用路径
  '/join',            // 注册页面
  '/signup',          // 可能的注册备用路径
  '/password_reset',  // 密码重置
  '/settings',        // 屏蔽所有设置页面 (包括 /settings/*)
  '/account',         // 账户相关页面
  '/new',             // 阻止创建新仓库/组织等的页面路径
];

// --- 要注入的横幅内容和标题前缀 (仅用于 github.com HTML) ---
const WARNING_BANNER_HTML = `
<div style="background-color: #fffbe6; color: #333; padding: 12px 20px; border-bottom: 1px solid #f5e79e; text-align: center; font-size: 14px; font-family: sans-serif; z-index: 99999; line-height: 1.5;">
  <strong>提示：</strong>这是一个非官方 GitHub 代理镜像，主要用于网络测试或访问加速。请勿在此进行登录、注册或处理任何敏感信息。进行这些操作请务必访问官方网站 <a href="https://github.com" target="_blank" rel="noopener noreferrer" style="color: #0056b3; text-decoration: underline; font-weight: bold;">github.com</a>。 Raw 内容也通过此代理提供。
</div>
`;
const TITLE_PREFIX = "[代理镜像] ";
// ================== 配置结束 ==================


export default {
  /**
   * 处理传入请求的主函数
   * @param {Request} request - 传入的请求对象
   * @param {object} env - 环境变量 (如果设置了)
   * @param {object} ctx - 执行上下文
   * @returns {Promise<Response>} - 返回给客户端的响应
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, search } = url;
    const workerOrigin = url.origin; // e.g., "https://github.iqach.top"
    const mainWorkerUrlBase = `${workerOrigin}${MAIN_PROXY_PREFIX}`; // e.g., "https://github.iqach.top/github"
    const upstreamBase = `https://${UPSTREAM_HOST}`; // "https://github.com"
    const rawUpstreamBase = `https://${RAW_UPSTREAM_HOST}`; // "https://raw.githubusercontent.com"
    const rawWorkerUrlBase = `${workerOrigin}${RAW_PROXY_PREFIX}`; // e.g., "https://github.iqach.top/raw-content"

    // --- 处理 CORS 预检请求 (OPTIONS) ---
    if (request.method === 'OPTIONS') {
      // OPTIONS 请求通常针对特定路径，handleOptions 需要能正确响应
      // 这里允许来自 workerOrigin 的所有路径的预检
      return handleOptions(request, workerOrigin);
    }

    // --- ********** 新增：处理 Raw 内容代理 ********** ---
    if (pathname.startsWith(RAW_PROXY_PREFIX + '/')) {
      // 从请求路径中移除代理前缀，得到原始 raw 内容的路径
      const rawPath = pathname.substring(RAW_PROXY_PREFIX.length); // 例如 /user/repo/branch/file.txt
      const rawUpstreamUrl = `${rawUpstreamBase}${rawPath}${search}`;

      // console.log(`Proxying RAW content request to: ${rawUpstreamUrl}`);

      // 复制请求头, 但设置正确的 Host 头指向 raw 上游
      const rawRequestHeaders = new Headers(request.headers);
      rawRequestHeaders.set('Host', RAW_UPSTREAM_HOST);
      rawRequestHeaders.delete('cf-connecting-ip');
      rawRequestHeaders.delete('cf-ipcountry');
      rawRequestHeaders.delete('cf-ray');
      rawRequestHeaders.delete('cf-visitor');

      try {
        // 创建并向上游发送请求 (允许跟随重定向，raw 内容通常不重定向或重定向是安全的)
        const rawUpstreamRequest = new Request(rawUpstreamUrl, {
          method: request.method,
          headers: rawRequestHeaders,
          body: request.body,
          redirect: 'follow', // 对于 raw content, follow 通常是安全的
        });

        const rawUpstreamResponse = await fetch(rawUpstreamRequest);

        // 复制响应头
        const rawResponseHeaders = new Headers(rawUpstreamResponse.headers);

        // **为 Raw 内容响应添加 CORS 头**
        addCorsHeaders(rawResponseHeaders, workerOrigin);

        // Raw 内容通常不需要移除 CSP 或注入内容，直接返回
        return new Response(rawUpstreamResponse.body, {
          status: rawUpstreamResponse.status,
          statusText: rawUpstreamResponse.statusText,
          headers: rawResponseHeaders,
        });

      } catch (error) {
        // console.error('Error fetching RAW upstream:', error);
        return new Response('Failed to fetch content from raw upstream server.', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    }
    // --- ********** Raw 内容代理处理结束 ********** ---


    // --- 路由检查：必须以 MAIN_PROXY_PREFIX 开头 ---
    if (!pathname.startsWith(MAIN_PROXY_PREFIX)) {
      return new Response("Not Found", { status: 404 });
    }

    // 获取真实路径 (去除前缀)
    const realPath = pathname.substring(MAIN_PROXY_PREFIX.length) || '/';

    // --- 如果不是 Raw 内容请求，则继续处理主 GitHub 站点的代理 ---

    // --- 1. 检查是否访问了主站点的被阻止路径 ---
    let isBlocked = BLOCKED_PATHS.some(blockedPath => {
      return realPath === blockedPath || realPath.startsWith(blockedPath + '/');
    });
    if (!isBlocked && realPath.startsWith('/settings/')) {
      isBlocked = true;
    }
    if (!isBlocked && realPath === '/settings') {
      isBlocked = BLOCKED_PATHS.includes('/settings');
    }

    if (isBlocked) {
      // console.log(`Blocked access attempt to main site path: ${realPath}`);
      return new Response(
        `Access to the path (${realPath}) is blocked by this proxy for security reasons.`,
        {
          status: 403,
          statusText: 'Forbidden',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }
      );
    }

    // --- 2. 构建并发送主站点上游请求 ---
    const upstreamUrl = `${upstreamBase}${realPath}${search}`;
    // console.log(`Proxying MAIN site request to: ${upstreamUrl}`);

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('Host', UPSTREAM_HOST);
    requestHeaders.delete('cf-connecting-ip');
    requestHeaders.delete('cf-ipcountry');
    requestHeaders.delete('cf-ray');
    requestHeaders.delete('cf-visitor');

    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: requestHeaders,
      body: request.body,
      redirect: 'manual', // 主站点需要手动处理重定向以重写 Location
    });

    try {
      const upstreamResponse = await fetch(upstreamRequest);
      const responseHeaders = new Headers(upstreamResponse.headers);
      let responseBody = upstreamResponse.body;
      let finalStatus = upstreamResponse.status;
      let finalStatusText = upstreamResponse.statusText;

      // --- 3a. 处理主站点重定向 (3xx 状态码) ---
      if (finalStatus >= 300 && finalStatus < 400) {
        const locationHeader = responseHeaders.get('Location');
        if (locationHeader) {
          try {
            const absoluteLocation = new URL(locationHeader, upstreamUrl).toString();
            // 重写 Location 中的 github.com 和 raw.githubusercontent.com
            let workerLocation = absoluteLocation.replaceAll(upstreamBase, mainWorkerUrlBase);
            workerLocation = workerLocation.replaceAll(rawUpstreamBase, rawWorkerUrlBase); // 新增替换
            responseHeaders.set('Location', workerLocation);
            // console.log(`Rewriting redirect: ${locationHeader} -> ${workerLocation}`);
          } catch (e) {
            // console.error("Error parsing/rewriting redirect URL:", e, `Original Location: ${locationHeader}`);
          }
        }
        addCorsHeaders(responseHeaders, workerOrigin);
        return new Response(upstreamResponse.body, { // 重定向通常 body 为空
          status: finalStatus,
          statusText: finalStatusText,
          headers: responseHeaders,
        });
      }

      // --- 3b. 移除主站点响应的 CSP 头 ---
      responseHeaders.delete('Content-Security-Policy');
      responseHeaders.delete('Content-Security-Policy-Report-Only');
      // console.log('Removed Content-Security-Policy headers for main site response.');

      // --- 3c. 为主站点响应添加 CORS 头 ---
      addCorsHeaders(responseHeaders, workerOrigin);

      // --- 3d. 处理主站点响应体 (HTML, JS 等) ---
      const contentType = responseHeaders.get('Content-Type');
      let bodyModified = false;

      if (contentType && (contentType.toLowerCase().includes('text/html') || contentType.toLowerCase().includes('javascript'))) {
        try {
          let originalBody = await upstreamResponse.text();
          let modifiedBody = originalBody;

          // *** 核心修改：替换响应体中的上游 URL ***
          // 1. 替换 github.com URL
          if (modifiedBody.includes(upstreamBase)) {
            modifiedBody = modifiedBody.replaceAll(upstreamBase, mainWorkerUrlBase);
            bodyModified = true;
            // console.log(`Performed URL rewrite (${upstreamBase} -> ${workerOrigin}) for: ${pathname}`);
          }
          // 2. *** 新增：替换 raw.githubusercontent.com URL ***
          if (modifiedBody.includes(rawUpstreamBase)) {
            modifiedBody = modifiedBody.replaceAll(rawUpstreamBase, rawWorkerUrlBase);
            bodyModified = true;
          }

          // 3. *** 新增：替换 HTML 中的根相对路径 (例如 action="/search", href="/login") ***
          // 匹配 href="/...", action="/...", src="/...", data-url="/..."
          // 排除协议相对路径 (//)
          // 排除 MAIN_PROXY_PREFIX 本身 (防止重复替换)
          const relativePathRegex = /(href|action|src|data-url)(=["'])\/(?!\/)/g;
          if (relativePathRegex.test(modifiedBody)) {
            modifiedBody = modifiedBody.replace(relativePathRegex, `$1$2${MAIN_PROXY_PREFIX}/`);
            bodyModified = true;
          }
          // console.log(`Performed URL rewrite (${rawUpstreamBase} -> ${rawWorkerUrlBase}) for: ${pathname}`);

          // --- 仅当内容是 HTML 时，才注入横幅和修改标题 ---
          if (contentType.toLowerCase().includes('text/html')) {
            // ... (注入横幅和修改标题的代码，和之前一样) ...
            // 1. 修改标题
            const titleRegex = /<title>(.*?)<\/title>/is;
            const newTitle = `<title>${TITLE_PREFIX}$1</title>`;
            if (titleRegex.test(modifiedBody)) {
              const oldTitleBody = modifiedBody;
              modifiedBody = modifiedBody.replace(titleRegex, newTitle);
              if (modifiedBody !== oldTitleBody) {
                // console.log(`Modified title for: ${pathname}`);
                bodyModified = true;
              }
            }
            // 2. 注入横幅
            const bodyTagRegex = /<body[^>]*>/i;
            const headTagRegex = /<\/head>/i;
            const oldBannerBody = modifiedBody;
            if (bodyTagRegex.test(modifiedBody)) {
              modifiedBody = modifiedBody.replace(bodyTagRegex, `$&${WARNING_BANNER_HTML}`);
            } else if (headTagRegex.test(modifiedBody)) {
              modifiedBody = modifiedBody.replace(headTagRegex, `</head>${WARNING_BANNER_HTML}`);
            } else {
              // console.warn(`Could not find <body> or </head> tag to inject banner for: ${pathname}`);
            }
            if (modifiedBody !== oldBannerBody) {
              // console.log(`Injected warning banner for: ${pathname}`);
              bodyModified = true;
            }
          }

          // --- 如果响应体被修改过，更新响应体和 Content-Length ---
          if (bodyModified) {
            responseBody = modifiedBody;
            const bodyBytes = new TextEncoder().encode(responseBody);
            responseHeaders.set('Content-Length', bodyBytes.length.toString());
            // console.log(`Updated Content-Length to ${bodyBytes.length} for modified body: ${pathname}`);
          } else {
            // ... (处理未修改情况的代码，和之前一样) ...
            // console.log(`HTML/JS detected for ${pathname}, but no modifications were applied. Serving read text.`);
            responseBody = originalBody;
            const bodyBytes = new TextEncoder().encode(responseBody);
            const originalLength = upstreamResponse.headers.get('Content-Length');
            if (originalLength && parseInt(originalLength) !== bodyBytes.length) {
              // console.warn(`Original Content-Length (${originalLength}) doesn't match re-encoded body length (${bodyBytes.length}) for ${pathname}. Setting new length.`);
              responseHeaders.set('Content-Length', bodyBytes.length.toString());
            } else if (!originalLength) {
              responseHeaders.set('Content-Length', bodyBytes.length.toString());
            }
          }

        } catch (err) {
          // console.error("Error reading or modifying main site HTML/JS body:", err);
          return new Response("Error processing main site content.", { status: 500, headers: { 'Content-Type': 'text/plain' } });
        }
      } else {
        // console.log(`Non-HTML/JS content type (${contentType || 'N/A'}) for main site path ${pathname}, passing through body.`);
      }

      // --- 4. 返回最终的主站点响应 ---
      return new Response(responseBody, {
        status: finalStatus,
        statusText: finalStatusText,
        headers: responseHeaders,
      });

    } catch (error) {
      // --- 5. 处理主站点 Fetch 错误 ---
      // console.error('Error fetching MAIN upstream:', error);
      return new Response('Failed to fetch content from upstream server.', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  },
};

/**
 * 处理 CORS 预检请求 (OPTIONS)
 * (保持不变，它基于请求的 Origin 和 Headers，与路径无关)
 * @param {Request} request - 传入的 OPTIONS 请求
 * @param {string} workerOrigin - Worker 的源
 * @returns {Response} - 预检响应
 */
function handleOptions(request, workerOrigin) {
  const headers = request.headers;
  if (
    headers.get('Origin') !== null &&
    headers.get('Access-Control-Request-Method') !== null &&
    headers.get('Access-Control-Request-Headers') !== null
  ) {
    const respHeaders = new Headers({
      'Access-Control-Allow-Origin': workerOrigin, // 允许来自 Worker 域的请求
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': headers.get('Access-Control-Request-Headers'),
      'Access-Control-Max-Age': '86400',
      // 'Access-Control-Allow-Credentials': 'true', // Optional
    });
    // console.log(`Handled CORS Preflight request for origin: ${headers.get('Origin')}`);
    return new Response(null, { headers: respHeaders, status: 204 });
  } else {
    // console.log('Handling standard OPTIONS request');
    return new Response(null, { headers: { Allow: 'GET, HEAD, POST, PUT, DELETE, OPTIONS' }, status: 200 });
  }
}

/**
 * 向响应头添加基本的 CORS 头信息
 * (保持不变，适用于所有从 Worker 返回的响应)
 * @param {Headers} headers - 要修改的 Headers 对象
 * @param {string} workerOrigin - Worker 的源
 */
function addCorsHeaders(headers, workerOrigin) {
  headers.set('Access-Control-Allow-Origin', workerOrigin);
  headers.set('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,DELETE,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Range');
  // headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range'); // Optional
  // headers.set('Access-Control-Allow-Credentials', 'true'); // Optional
  // headers.set('Vary', 'Origin'); // Optional, but good practice
  // console.log(`Added CORS headers for origin: ${workerOrigin}`);
}