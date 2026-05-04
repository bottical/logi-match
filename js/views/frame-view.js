export function renderFrameView(container, src, title) {
  container.innerHTML = `
    <section class="page-section">
      <header class="page-header">
        <h1>${title}</h1>
      </header>
      <iframe class="app-frame" src="${src}" title="${title}"></iframe>
    </section>
  `;
  return () => {};
}
