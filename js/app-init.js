(function(){
  function toErrorMessage(errorCode){
    const map = {
      USER_NOT_REGISTERED: 'ログインユーザーの初期設定に失敗しました。Firebase Auth ユーザーが有効か確認してください。',
      CLIENT_ID_MISSING: 'ログインユーザーに clientId が設定されていません。',
      ROLE_MISSING: 'ログインユーザーに role が設定されていません。',
      USER_INACTIVE: 'このユーザーは無効化されています。',
      CLIENT_NOT_FOUND: '紐づくクライアント設定が存在しません。',
      CLIENT_INACTIVE: '紐づくクライアント設定が無効化されています。',
      CSV_MAPPING_MISSING: 'CSVマッピング設定が未作成です。',
      BOOTSTRAP_NOT_AVAILABLE: 'このログインユーザーの初期設定は利用できません。管理者に確認してください。',
      BOOTSTRAP_EMAIL_MISMATCH: 'ログインメールアドレスが事前登録情報と一致しません。管理者に確認してください。',
      USER_ALREADY_EXISTS: 'このログインユーザーは既に登録済みです。設定状態を確認してください。'
    };
    return map[errorCode] || '利用権限またはテナント設定に問題があります。管理者に確認してください。';
  }

  window.initializeAppContext = async function(pageId){
    try {
      const user = await window.requireLogin();

      if (typeof window.bootstrapTenantIfNeeded === 'function') {
        await window.bootstrapTenantIfNeeded(user);
      }

      await window.loadTenantContext(user);

      const clientId = window.appContext?.clientId;
      const pagesRequireCsvMapping = ['master-import', 'csv-mapping'];
      if (clientId && pagesRequireCsvMapping.includes(pageId)) {
        const csvMapping = await window.firestorePaths.csvMappingCurrent(clientId).get();
        if (!csvMapping.exists) throw new Error('CSV_MAPPING_MISSING');
      }

      window.checkPagePermission(pageId);
      return window.appContext;
    } catch (e) {
      if (e.message === 'AUTH_REQUIRED') location.href = './login.html';
      else if (e.message === 'PERMISSION_DENIED') { alert('この画面にアクセスできません。検品実行画面へ移動します。'); location.href='./inspection.html'; }
      else { console.error('[app-init] failed', e); alert(toErrorMessage(e.message)); location.href='./login.html'; }
      throw e;
    }
  };
})();
