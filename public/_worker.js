export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return env.CIACPARTY_BACKEND.fetch(request);
    }
    if (url.pathname === '/mobile') return Response.redirect(new URL('/play', url), 302);
    if (url.pathname === '/host') return Response.redirect(new URL('/', url), 302);
    return env.ASSETS.fetch(request);
  }
};
