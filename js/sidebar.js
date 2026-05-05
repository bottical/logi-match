(function(){
  function isShellMode(){
    return new URLSearchParams(window.location.search).get('shell') === '1';
  }

  window.renderSidebar = function(){
    if (isShellMode()) return;

    const host=document.getElementById('sidebarHost'); if(!host) return;
    const page=document.body.dataset.page||''; const role=window.appContext?.role;
    const items=[
      { id:'inspection',href:'./#inspection',label:'検品実行',roles:['owner','admin','operator']},
      { id:'master-import',href:'./#master-import',label:'ピッキングマスター登録',roles:['owner','admin']},
      { id:'import-history',href:'./#import-history',label:'マスター投入履歴',roles:['owner','admin']},
      { id:'unstarted-list',href:'./#unstarted-list',label:'検品未着手一覧',roles:['owner','admin','operator']},
      { id:'completed-list',href:'./#completed-list',label:'検品完了一覧',roles:['owner','admin']},
      { id:'result-download',href:'./#result-download',label:'検品実績DL',roles:['owner','admin']}
    ].filter(i=>i.roles.includes(role));
    host.className='main-sidebar inspection-sidebar';
    host.innerHTML=`<div class="brand-link"><span class="brand-text">ロジマッチ</span></div><div class="sidebar"><div style="padding:8px;color:#fff;font-size:12px;">${window.appContext?.tenantName||window.appContext?.tenantId||''}<br>${window.appContext?.email||''}</div><nav class="mt-2"><ul class="nav nav-pills nav-sidebar flex-column">${items.map(i=>`<li class='nav-item'><a class='nav-link ${i.id===page?'active':''}' href='${i.href}'><p>${i.label}</p></a></li>`).join('')}<li class='nav-item'><a class='nav-link' href='#' id='logoutLink'><p>ログアウト</p></a></li></ul></nav></div>`;
    document.getElementById('headerUserName') && (document.getElementById('headerUserName').textContent=window.appContext?.email||'');
    document.getElementById('logoutLink')?.addEventListener('click', async(e)=>{e.preventDefault(); await window.authApi.logout(); location.href='./login.html';});

    const applySidebarState = () => {
      const saved = localStorage.getItem('sidebarCollapsed');
      if (saved == null && window.matchMedia('(max-width: 900px)').matches) {
        document.body.classList.add('sidebar-collapsed');
        return;
      }
      document.body.classList.toggle('sidebar-collapsed', saved === '1');
    };
    applySidebarState();
    const toggle = document.getElementById('sidebarToggle');
    toggle?.addEventListener('click', () => {
      const next = !document.body.classList.contains('sidebar-collapsed');
      document.body.classList.toggle('sidebar-collapsed', next);
      localStorage.setItem('sidebarCollapsed', next ? '1' : '0');
    });
  };
})();
