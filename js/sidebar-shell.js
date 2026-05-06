export const MENU_ITEMS = [
  { id: 'inspection', label: '検品実行', hash: '#inspection', roles: ['owner', 'admin', 'worker'] },
  { id: 'master-import', label: 'ピッキングマスター登録', hash: '#master-import', roles: ['owner', 'admin'] },
  { id: 'import-history', label: 'マスター投入履歴', hash: '#import-history', roles: ['owner', 'admin'] },
  { id: 'unstarted-list', label: '検品未着手一覧', hash: '#unstarted-list', roles: ['owner', 'admin', 'worker'] },
  { id: 'completed-list', label: '検品完了一覧', hash: '#completed-list', roles: ['owner', 'admin'] },
  { id: 'result-download', label: '検品実績DL', hash: '#result-download', roles: ['owner', 'admin'] },
  { id: 'internal-users', label: 'ユーザー管理（弊社専用）', hash: '#internal-users', roles: ['systemOwner'], internalOnly: true },
];

const ADMIN_ROLES = ['owner', 'admin'];
const WORKER_ROLE = 'worker';

function normalizeRole(role) {
  return role === 'operator' ? WORKER_ROLE : role;
}

function isAdminRole(role) {
  return ADMIN_ROLES.includes(normalizeRole(role));
}

function clearAppContext() {
  if (!window.appContext) return;
  window.appContext.uid = null;
  window.appContext.email = null;
  window.appContext.tenantId = null;
  window.appContext.role = null;
  window.appContext.displayName = null;
  window.appContext.tenantName = null;
}

let initialized = false;

export function getCurrentPageId() {
  const rawHash = window.location.hash.replace('#', '') || 'inspection';
  return rawHash.split('?')[0] || 'inspection';
}

export function getCurrentHashParams() {
  const rawHash = window.location.hash.replace('#', '');
  const queryString = rawHash.includes('?') ? rawHash.split('?').slice(1).join('?') : '';
  return new URLSearchParams(queryString);
}

export function updateSidebarActive(pageId) {
  document.querySelectorAll('.sidebar-link[data-page]').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.page === pageId);
  });
}

function getVisibleItems() {
  const role = normalizeRole(window.appContext?.role);
  if (!role) return [];

  return MENU_ITEMS.filter((item) => {
    if (item.internalOnly) {
      return typeof window.isInternalAdmin === 'function' && window.isInternalAdmin(window.appContext);
    }
    if (role === WORKER_ROLE) {
      return item.roles.includes(WORKER_ROLE);
    }
    if (isAdminRole(role)) {
      return item.roles.includes(role) || item.roles.includes(WORKER_ROLE);
    }
    return item.roles.includes(role);
  });
}

export function bindSidebarNavigation() {
  const sidebar = document.getElementById('appSidebar');
  if (!sidebar) return;

  sidebar.addEventListener('click', (event) => {
    const link = event.target.closest('.sidebar-link[data-page]');
    if (!link) return;

    event.preventDefault();
    const pageId = link.dataset.page;
    if (!pageId) return;

    const nextHash = `#${pageId}`;
    if (window.location.hash === nextHash) return;
    window.location.hash = nextHash;
  });
}

export function initSidebar() {
  const sidebar = document.getElementById('appSidebar');
  if (!sidebar || initialized) return;

  const visibleItems = getVisibleItems();
  const tenantLabel = window.appContext?.tenantName || window.appContext?.tenantId || '';
  const email = window.appContext?.email || '';

  sidebar.innerHTML = `
    <div class="sidebar-brand"><div class="sidebar-title">検品システム</div></div>
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
  updateSidebarActive(getCurrentPageId());
}
