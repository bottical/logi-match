(function () {
  const host = document.getElementById('sidebarHost');
  if (!host) return;
  const page = document.body.dataset.page || document.querySelector('.wrapper')?.dataset.page || '';
  const items = [
    { id: 'inspection', href: 'inspection.html', label: '検品実行' },
    { id: 'master-import', href: 'master-import.html', label: 'ピッキングマスター登録' },
    { id: 'import-history', href: 'import-history.html', label: 'マスター投入履歴' },
    { id: 'unstarted-list', href: 'unstarted-list.html', label: '検品未着手一覧' },
    { id: 'completed-list', href: 'completed-list.html', label: '検品完了一覧' },
    { id: 'result-download', href: 'result-download.html', label: '検品実績DL' }
  ];
  host.className = 'main-sidebar inspection-sidebar';
  host.innerHTML = `<div class="brand-link"><span class="brand-text">ロジマッチ</span></div><div class="sidebar"><nav class="mt-2"><ul class="nav nav-pills nav-sidebar flex-column">${items.map((item) => `<li class="nav-item"><a class="nav-link ${item.id === page ? 'active' : ''}" href="${item.href}"><p>${item.label}</p></a></li>`).join('')}</ul></nav></div>`;
})();
