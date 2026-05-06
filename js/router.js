import { initSidebar, bindSidebarNavigation, updateSidebarActive, getCurrentPageId } from './sidebar-shell.js';
import { renderInspectionView } from './views/inspection-view.js';
import { renderMasterImportView } from './views/master-import-view.js';
import { renderImportHistoryView } from './views/import-history-view.js';
import { renderUnstartedListView } from './views/unstarted-list-view.js';
import { renderCompletedListView } from './views/completed-list-view.js';
import { renderResultDownloadView } from './views/result-download-view.js';
import { renderInternalUsersView } from './views/internal-users-view.js';

const routes = {
  inspection: renderInspectionView,
  'master-import': renderMasterImportView,
  'import-history': renderImportHistoryView,
  'unstarted-list': renderUnstartedListView,
  'completed-list': renderCompletedListView,
  'result-download': renderResultDownloadView,
  'internal-users': renderInternalUsersView,
};

let currentCleanup = null;

function waitForAppContext(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (window.appContext?.role || Date.now() - startedAt > timeoutMs) {
        resolve();
        return;
      }
      window.requestAnimationFrame(tick);
    };
    tick();
  });
}

async function renderRoute() {
  const pageId = getCurrentPageId();
  const renderer = routes[pageId];
  if (!renderer) {
    window.location.hash = '#inspection';
    return;
  }

  if (typeof currentCleanup === 'function') {
    currentCleanup();
    currentCleanup = null;
  }

  updateSidebarActive(pageId);
  const content = document.getElementById('appContent');
  if (!content) return;

  content.innerHTML = '';

  try {
    const cleanup = await renderer(content);
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (error) {
    console.error('[router] render failed:', error);
    content.innerHTML = `
      <section class="page-section">
        <h1>画面の表示に失敗しました</h1>
        <p>時間をおいて再度お試しください。</p>
      </section>
    `;
  }
}

window.addEventListener('hashchange', renderRoute);

document.addEventListener('DOMContentLoaded', async () => {
  await waitForAppContext();
  initSidebar();
  bindSidebarNavigation();
  if (!window.location.hash) {
    window.location.hash = '#inspection';
    return;
  }
  renderRoute();
});
