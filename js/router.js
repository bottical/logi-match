console.info('[router] module loaded');
import { initSidebar, bindSidebarNavigation, updateSidebarActive, getCurrentPageId } from './sidebar-shell.js';
import { renderMasterImportView } from './views/master-import-view.js';
import { renderImportHistoryView } from './views/import-history-view.js';
import { renderUnstartedListView } from './views/unstarted-list-view.js';
import { renderCompletedListView } from './views/completed-list-view.js';
import { renderResultDownloadView } from './views/result-download-view.js';
import { renderInternalUsersView } from './views/internal-users-view.js';
import { renderWorkersView } from './views/workers-view.js';
import { renderCsvMappingView } from './views/csv-mapping-view.js';
import { renderInternalWorkersView } from './views/internal-workers-view.js';

const ASSET_VERSION = '20260513-1';
const CLIENT_REQUIRED_MESSAGE = 'クライアント情報が未設定です。管理者に確認してください。';
const CLIENT_REQUIRED_ROUTES = new Set([
  'inspection',
  'master-import',
  'import-history',
  'unstarted-list',
  'completed-list',
  'csv-mapping',
  'result-download',
  'workers',
]);
const INTERNAL_ROUTES = new Set(['internal-users', 'internal-workers']);

const routes = {
  inspection: async (container) => {
    const { renderInspectionView } = await import(`./views/inspection-view.js?v=${ASSET_VERSION}`);
    return renderInspectionView(container);
  },
  'master-import': renderMasterImportView,
  'import-history': renderImportHistoryView,
  'unstarted-list': renderUnstartedListView,
  'completed-list': renderCompletedListView,
  'result-download': renderResultDownloadView,
  workers: renderWorkersView,
  'csv-mapping': renderCsvMappingView,
  'internal-users': renderInternalUsersView,
  'internal-workers': renderInternalWorkersView,
};

let currentCleanup = null;
const framePageIds = new Set(Object.keys(routes));

function hasInternalAccess(ctx) {
  return ctx?.isSystemOwner === true || window.permissions?.isInternalAdmin?.(ctx) || window.isInternalAdmin?.(ctx);
}

function validateRouteAccess(pageId, ctx) {
  if (INTERNAL_ROUTES.has(pageId)) {
    if (!hasInternalAccess(ctx)) throw new Error('PERMISSION_DENIED');
    return;
  }

  if (CLIENT_REQUIRED_ROUTES.has(pageId) && !ctx?.clientId) {
    throw new Error('CLIENT_ID_MISSING_FOR_ROUTE');
  }

  if (window.permissions && !window.permissions.hasPageAccess(pageId, ctx?.role)) {
    throw new Error('PERMISSION_DENIED');
  }
}

function renderClientMissing(content) {
  content.classList.remove('is-frame-content');
  content.innerHTML = `<section class="page-section"><h1>${CLIENT_REQUIRED_MESSAGE}</h1></section>`;
}

function renderError(content) {
  content.classList.remove('is-frame-content');
  content.innerHTML = `
    <section class="page-section">
      <h1>画面の表示に失敗しました</h1>
      <p>時間をおいて再度お試しください。</p>
      <p><button type="button" class="secondary-action" id="routeErrorLogoutButton">ログアウト</button></p>
    </section>
  `;
  document.getElementById('routeErrorLogoutButton')?.addEventListener('click', async () => {
    try {
      if (window.authApi?.logout) {
        await window.authApi.logout();
      } else if (window.firebase?.auth) {
        await window.firebase.auth().signOut();
      }
    } finally {
      window.location.href = './login.html';
    }
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
  const content = document.getElementById('appContent');
  if (!content) return;
  content.classList.toggle('is-frame-content', framePageIds.has(pageId));
  content.innerHTML = '';
  let ctx = null;
  try {
    ctx = await window.appInit.ready();
    console.info('[router] context loaded', { pageId, role: ctx?.role, uid: ctx?.uid, clientId: ctx?.clientId, tenantId: ctx?.tenantId });
    initSidebar(ctx, pageId);
    updateSidebarActive(pageId);
    validateRouteAccess(pageId, ctx);
    const cleanup = await renderer(content);
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (error) {
    console.error('[router] render failed', {
      route: pageId,
      uid: ctx?.user?.uid || ctx?.uid || window.appContext?.user?.uid || window.appContext?.uid || null,
      role: ctx?.role || window.appContext?.role || null,
      clientId: ctx?.clientId || window.appContext?.clientId || null,
      message: error?.message || String(error),
      error,
    });
    if (error?.message === 'CLIENT_ID_MISSING_FOR_ROUTE') {
      renderClientMissing(content);
      return;
    }
    renderError(content);
  }
}

window.addEventListener('hashchange', renderRoute);
document.addEventListener('DOMContentLoaded', async () => {
  console.info('[router] DOMContentLoaded');
  bindSidebarNavigation();
  if (!window.location.hash) {
    window.location.hash = '#inspection';
    return;
  }
  renderRoute();
});
