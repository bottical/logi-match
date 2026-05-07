export const MENU_ITEMS = [
  { id: 'inspection', label: '検品実行', hash: '#inspection' },
  { id: 'master-import', label: 'ピッキングマスター登録', hash: '#master-import' },
  { id: 'import-history', label: 'マスター投入履歴', hash: '#import-history' },
  { id: 'unstarted-list', label: '検品未着手一覧', hash: '#unstarted-list' },
  { id: 'completed-list', label: '検品完了一覧', hash: '#completed-list' },
  { id: 'result-download', label: '検品実績DL', hash: '#result-download' },
  { id: 'workers', label: '作業者状態', hash: '#workers' },
  { id: 'csv-mapping', label: 'CSVマッピング設定', hash: '#csv-mapping' },
  { id: 'internal-users', label: 'ログインユーザー管理（弊社専用）', hash: '#internal-users' },
  { id: 'internal-workers', label: '検品作業者管理（弊社専用）', hash: '#internal-workers' },
];

let initialized = false;
let lastRenderKey = null;

function clearAppContext() {
  initialized = false;
  lastRenderKey = null;
  if (!window.appContext) return;
  window.appContext.uid = null;
  window.appContext.email = null;
  window.appContext.tenantId = null;
  window.appContext.clientId = null;
  window.appContext.role = null;
}

function makeSidebarRenderKey(ctx) {
  return [ctx?.uid || '', ctx?.tenantId || '', ctx?.clientId || '', ctx?.role || '', ctx?.email || '', ctx?.tenantName || '', ctx?.clientName || ''].join('|');
}

function getSidebarHost() { return document.getElementById('appSidebar') || document.getElementById('sidebarHost'); }
export function getCurrentPageId() { const rawHash = window.location.hash.replace('#', '') || 'inspection'; return rawHash.split('?')[0] || 'inspection'; }
export function getCurrentHashParams() { const rawHash = window.location.hash.replace('#', ''); const queryString = rawHash.includes('?') ? rawHash.split('?').slice(1).join('?') : ''; return new URLSearchParams(queryString); }
export function updateSidebarActive(pageId) { document.querySelectorAll('.sidebar-link[data-page]').forEach((link) => { link.classList.toggle('is-active', link.dataset.page === pageId); }); }

function getVisibleItems(ctx) {
  const role = window.permissions?.normalizeRole(ctx?.role) || '';
  if (!role) return [];
  return MENU_ITEMS.filter((item) => window.permissions?.hasPageAccess(item.id, role));
}

export function bindSidebarNavigation() {
  const sidebar = getSidebarHost(); if (!sidebar) return;
  sidebar.addEventListener('click', (event) => {
    const link = event.target.closest('.sidebar-link[data-page]'); if (!link) return;
    event.preventDefault(); const pageId = link.dataset.page; if (!pageId) return;
    const nextHash = `#${pageId}`; if (window.location.hash !== nextHash) window.location.hash = nextHash;
  });
}

export function initSidebar(ctx = window.appContext, pageId = getCurrentPageId()) {
  const sidebar = getSidebarHost(); if (!sidebar) return;
  const role = window.permissions?.normalizeRole(ctx?.role) || '';
  if (!role) { sidebar.innerHTML = '<div class="sidebar-empty"><p>表示可能なメニューがありません。</p><small>role: -</small></div>'; return; }

  const renderKey = makeSidebarRenderKey(ctx);
  if (initialized && lastRenderKey === renderKey) { updateSidebarActive(pageId); return; }
  lastRenderKey = renderKey;

  const visibleItems = getVisibleItems(ctx);
  const tenantLabel = ctx?.clientName || ctx?.tenantName || ctx?.clientId || ctx?.tenantId || '';
  const email = ctx?.email || '';

  sidebar.innerHTML = `
    <div class="sidebar-brand"><div class="sidebar-title">ロジマッチ</div></div>
    <div class="sidebar-user">${tenantLabel}<br>${email}</div>
    <nav class="sidebar-nav">
      ${visibleItems.map((item) => `<a href="${item.hash}" class="sidebar-link" data-page="${item.id}">${item.label}</a>`).join('')}
      <a href="#" class="sidebar-link" id="shellLogoutLink">ログアウト</a>
    </nav>
  `;

  document.getElementById('shellLogoutLink')?.addEventListener('click', async (event) => {
    event.preventDefault();
    await window.authApi.logout();
    clearAppContext();
    window.location.href = './login.html';
  });

  initialized = true;
  updateSidebarActive(pageId);
}
