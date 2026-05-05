export function renderFrameView(container, src, title) {
  container.innerHTML = `
    <section class="page-section">
      <header class="page-header">
        <h1>${title}</h1>
      </header>
      <iframe class="app-frame is-loading" src="${src}" title="${title}"></iframe>
    </section>
  `;
  const frame = container.querySelector('.app-frame');
  frame?.addEventListener('load', () => {
    frame.classList.remove('is-loading');
  }, { once: true });

  return () => {};
}
