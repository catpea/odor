      const pagerHtml = totalPages > 1
        ? `  <nav class="pager">
    <a href="page-${totalPages}.html">Browse Archive</a>
${homePager.map(p => p.ariaCurrent
  ? `    <a aria-current="true"href="${p.url}">${p.text}</a>`
  : `    <a href="${p.url}">${p.text}</a>`
).join('\n')}
  </nav>`
