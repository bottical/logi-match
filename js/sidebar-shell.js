export const MENU_ITEMS = [
  { id: 'inspection', label: '検品実行', hash: '#inspection', roles: ['owner', 'admin', 'operator'] },
  { id: 'master-import', label: 'ピッキングマスター登録', hash: '#master-import', roles: ['owner', 'admin'] },
  { id: 'import-history', label: 'マスター投入履歴', hash: '#import-history', roles: ['owner', 'admin'] },
  { id: 'unstarted-list', label: '検品未着手一覧', hash: '#unstarted-list', roles: ['owner', 'admin', 'operator'] },
  { id: 'completed-list', label: '検品完了一覧', hash: '#completed-list', roles: ['owner', 'admin'] },
  { id: 'result-download', label: '検品実績DL', hash: '#result-download', roles: ['owner', 'admin'] },
];

let initialized = false;

export function getCurrentPageId() {
  return window.location.hash.replace('#', '') || 'inspection';
}

export function updateSidebarActive(pageId) {
  document.querySelectorAll('.sidebar-link[data-page]').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.page === pageId);
  });
}

function getVisibleItems() {
  const role = window.appContext?.role;
  if (!role) {
    return MENU_ITEMS.filter((item) => item.roles.includes('operator'));
  }
  return MENU_ITEMS.filter((item) => item.roles.includes(role));
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
    window.location.href = './login.html';
  });

  initialized = true;
  updateSidebarActive(getCurrentPageId());
}
