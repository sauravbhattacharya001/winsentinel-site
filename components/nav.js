// Shared site header and footer — injected via JS for maintainability.
// Each page includes: <div id="site-header"></div> ... <div id="site-footer"></div>
// Then <script src="/components/nav.js"></script> at the end of <body>.

(function () {
  var header = document.getElementById('site-header');
  var footer = document.getElementById('site-footer');

  if (header) {
    header.outerHTML = [
      '<header class="border-b border-white/5 bg-ink-950/60 backdrop-blur sticky top-0 z-40">',
      '  <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">',
      '    <a href="/" class="flex items-center gap-2 font-semibold">',
      '      <svg viewBox="0 0 64 64" class="w-7 h-7"><path fill="#38bdf8" d="M32 4 8 14v18c0 14 10 24 24 28 14-4 24-14 24-28V14L32 4Z"/><path fill="#0b0f17" d="m28 38-7-7 3-3 4 4 11-11 3 3-14 14Z"/></svg>',
      '      <span>WinSentinel</span>',
      '      <span class="ml-2 text-xs rounded-full border border-sky-400/30 text-sky-300 px-2 py-0.5">beta</span>',
      '    </a>',
      '    <nav class="hidden md:flex items-center gap-7 text-sm text-slate-300">',
      '      <a href="/#features" class="hover:text-white">Features</a>',
      '      <a href="/modules" class="hover:text-white">Modules</a>',
      '      <a href="/fleet" class="hover:text-white">Fleet</a>',
      '      <a href="/pricing" class="hover:text-white">Pricing</a>',
      '      <a href="/blog" class="hover:text-white">Blog</a>',
      '      <a href="/changelog" class="hover:text-white">Changelog</a>',
      '      <a href="/docs/" class="hover:text-white">Docs</a>',
      '      <a href="/vs/" class="hover:text-white">Compare</a>',
      '      <a href="/portal" class="hover:text-white">Portal</a>',
      '<a href="/#install" class="hover:text-white">Install</a>',
      '      <a href="https://github.com/sauravbhattacharya001/WinSentinel" class="hover:text-white">GitHub</a>',
      '    </nav>',
      '    <a href="/#waitlist" class="text-sm bg-sky-500 hover:bg-sky-400 text-ink-950 font-semibold px-3.5 py-2 rounded-md">Join waitlist</a>',
      '  </div>',
      '</header>'
    ].join('\n');
  }

  if (footer) {
    footer.outerHTML = [
      '<footer class="border-t border-white/5">',
      '  <div class="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-400">',
      '    <div class="flex items-center gap-2">',
      '      <svg viewBox="0 0 64 64" class="w-5 h-5"><path fill="#38bdf8" d="M32 4 8 14v18c0 14 10 24 24 28 14-4 24-14 24-28V14L32 4Z"/><path fill="#0b0f17" d="m28 38-7-7 3-3 4 4 11-11 3 3-14 14Z"/></svg>',
      '      <span>\u00a9 2026 WinSentinel</span>',
      '    </div>',
      '    <div class="flex flex-wrap items-center gap-5">',
      '      <a href="https://github.com/sauravbhattacharya001/WinSentinel" class="hover:text-white">GitHub</a>',
      '      <a href="/modules" class="hover:text-white">Modules</a>',
      '      <a href="/fleet" class="hover:text-white">Fleet</a>',
      '      <a href="/pricing" class="hover:text-white">Pricing</a>',
      '      <a href="/blog" class="hover:text-white">Blog</a>',
      '      <a href="/changelog" class="hover:text-white">Changelog</a>',
      '      <a href="/docs/" class="hover:text-white">Docs</a>',
      '      <a href="/portal" class="hover:text-white">Portal</a>',
      '<a href="https://www.nuget.org/packages/WinSentinel.Cli" class="hover:text-white">NuGet</a>',
      '      <a href="/.well-known/security.txt" class="hover:text-white">Security</a>',
      '    </div>',
      '  </div>',
      '</footer>'
    ].join('\n');
  }
  // Cloudflare Web Analytics (cookie-free, privacy-first)
  if (!document.querySelector('script[data-cf-beacon]')) {
    var s = document.createElement('script');
    s.defer = true;
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon', '{"token": "__CF_ANALYTICS_TOKEN__"}');
    document.body.appendChild(s);
  }
})();
/* cache-bust */
