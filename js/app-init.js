(function(){
  window.initializeAppContext = async function(pageId){
    try {
      const user = await window.requireLogin();
      await window.loadTenantContext(user);
      window.checkPagePermission(pageId);
      return window.appContext;
    } catch (e) {
      if (e.message === 'AUTH_REQUIRED') location.href = './login.html';
      else if (e.message === 'PERMISSION_DENIED') { alert('この画面にアクセスできません。検品実行画面へ移動します。'); location.href='./inspection.html'; }
      else { alert('利用権限またはテナント設定に問題があります。管理者に確認してください。'); location.href='./login.html'; }
      throw e;
    }
  };
})();
