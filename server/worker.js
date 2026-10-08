export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Root redirect: Forward root visits to default game app
    if (url.pathname === '/' || url.pathname === '') {
      return Response.redirect('https://idlemullet.com/idle-distribution', 302);
    }

    // 2. Subpath routing for idle-distribution
    if (url.pathname.startsWith('/idle-distribution')) {
      // Strip /idle-distribution prefix to map directly to files in dist
      const subpath = url.pathname.replace(/^\/idle-distribution/, '') || '/';
      const assetUrl = new URL(subpath, request.url);
      let response = await env.ASSETS.fetch(new Request(assetUrl, request));

      // SPA fallback: return index.html for client routes (unless requesting a missing static file)
      if (response.status === 404 && !subpath.startsWith('/assets/') && !subpath.includes('.')) {
        response = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
      }

      return response;
    }

    return new Response('Not Found', { status: 404 });
  }
};
