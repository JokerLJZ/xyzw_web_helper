// public/_worker.js
// Cloudflare Pages Advanced Mode - 替代 nginx 反向代理

// 代理路由表(对应 nginx 的 location 配置)
const PROXY_ROUTES = [
  {
    prefix: '/api/weixin-long/',  // 注意:更具体的前缀必须放在前面
    target: 'https://long.open.weixin.qq.com',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN',
      'Accept': '*/*',
      'Referer': 'https://open.weixin.qq.com/',
      'Origin': 'https://open.weixin.qq.com',
    },
  },
  {
    prefix: '/api/weixin/',
    target: 'https://open.weixin.qq.com',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Referer': 'https://open.weixin.qq.com/',
      'Origin': 'https://open.weixin.qq.com',
    },
  },
  {
    prefix: '/api/hortor/',
    target: 'https://comb-platform.hortorgames.com',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 12; 23117RK66C Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Mobile Safari/537.36',
      'Accept': '*/*',
      'Connection': 'keep-alive',
      'Content-Type': 'text/plain; charset=utf-8',
      'Origin': 'https://open.weixin.qq.com',
      'Referer': 'https://open.weixin.qq.com/',
    },
  },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 匹配代理规则
    for (const route of PROXY_ROUTES) {
      if (url.pathname.startsWith(route.prefix)) {
        return handleProxy(request, url, route);
      }
    }

    // 非 API 请求 → 交给 Pages 静态资源处理
    // (env.ASSETS.fetch 会自动处理 SPA fallback,如果配了 _redirects)
    return env.ASSETS.fetch(request);
  },
};

async function handleProxy(request, url, route) {
  // 构造目标 URL:去掉前缀,拼到 target 后面(等价于 nginx 的 rewrite)
  const subPath = url.pathname.slice(route.prefix.length);
  const targetUrl = `${route.target}/${subPath}${url.search}`;

  // 复制原请求头,然后用伪装头覆盖
  const proxyHeaders = new Headers(request.headers);
  for (const [key, value] of Object.entries(route.headers)) {
    proxyHeaders.set(key, value);
  }
  // Host 头由 fetch 自动根据目标 URL 设置,不需要手动指定
  proxyHeaders.delete('host');

  // 构造代理请求
  const proxyRequest = new Request(targetUrl, {
    method: request.method,
    headers: proxyHeaders,
    body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
    redirect: 'follow',
  });

  try {
    // 15 秒超时(对应 nginx 的 proxy_*_timeout 15s)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(proxyRequest, { signal: controller.signal });
    clearTimeout(timeout);

    // 给响应加上 CORS 头,允许浏览器跨域访问
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', '*');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Proxy failed', message: error.message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
