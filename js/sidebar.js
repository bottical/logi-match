(function(){
  function clearAppContext(){
    if (!window.appContext) return;
    window.appContext.uid = null;
    window.appContext.email = null;
    window.appContext.tenantId = null;
    window.appContext.clientId = null;
    window.appContext.role = null;
    window.appContext.displayName = null;
    window.appContext.tenantName = null;
    window.appContext.clientName = null;
  }
  function isShellMode(){ return new URLSearchParams(window.location.search).get('shell') === '1'; }
  window.renderSidebar = function(){
    if (isShellMode()) return;
    const host=document.getElementById('sidebarHost'); if(!host){ return; }
    const page=(window.location.hash||'#inspection').replace(/^#/,'');
    const role=window.permissions?.normalizeRole(window.appContext?.role); if(!role){ return; }

    const defs=[
      { id:'inspection',href:'./#inspection',label:'検品実行'},
      { id:'master-import',href:'./#master-import',label:'ピッキングマスター登録'},
      { id:'import-history',href:'./#import-history',label:'マスター投入履歴'},
      { id:'unstarted-list',href:'./#unstarted-list',label:'検品未着手一覧'},
      { id:'completed-list',href:'./#completed-list',label:'検品完了一覧'},
      { id:'result-download',href:'./#result-download',label:'検品実績DL'},
      { id:'workers',href:'./#workers',label:'作業者状態'},
      { id:'csv-mapping',href:'./#csv-mapping',label:'CSVマッピング設定'},
      { id:'internal-users',href:'./#internal-users',label:'ログインユーザー管理（弊社専用）'},
      { id:'internal-workers',href:'./#internal-workers',label:'検品作業者管理（弊社専用）'},
    ];
    const items=defs.filter((i)=> window.permissions?.hasPageAccess(i.id, role));

    host.className='main-sidebar inspection-sidebar';
    host.innerHTML=`<div class="brand-link"><span class="brand-text">ロジマッチ</span></div><div class="sidebar"><div style="padding:8px;color:#fff;font-size:12px;">${window.appContext?.clientName||window.appContext?.tenantName||''}<br>${window.appContext?.email||''}</div><nav class="mt-2"><ul class="nav nav-pills nav-sidebar flex-column">${items.map(i=>`<li class='nav-item'><a class='nav-link ${i.id===page?'active':''}' href='${i.href}'><p>${i.label}</p></a></li>`).join('')}<li class='nav-item'><a class='nav-link' href='#' id='logoutLink'><p>ログアウト</p></a></li></ul></nav></div>`;
    document.getElementById('logoutLink')?.addEventListener('click', async(e)=>{e.preventDefault(); await window.authApi.logout(); clearAppContext(); location.href='./login.html';});

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
