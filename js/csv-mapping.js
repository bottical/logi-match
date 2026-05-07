(async function () {
  const statusEl = document.getElementById('mappingStatus');
  const form = document.getElementById('mappingForm');
  const fields = ['pickingNo', 'jan', 'alternativeCode', 'productName', 'quantity', 'destinationName', 'slipNo', 'shipDate', 'shipperName', 'location'];

  function isValidColumnLetter(value) {
    if (!value) return true;
    return /^[A-Z]+$/i.test(value);
  }

  function setStatus(message, type) {
    if (!statusEl) return;
    statusEl.className = `status-message status-message--${type}`;
    statusEl.textContent = message;
  }

  function normalizeColumnValue(value) {
    return String(value || '').trim().toUpperCase();
  }

  let ctx;
  try {
    ctx = await window.appInit.ready(document.body.dataset.page);
    console.debug('[app-init]', { page: document.body.dataset.page, hasAppInit: !!window.appInit, hasFirestorePaths: !!window.firestorePaths, clientId: ctx.clientId, role: ctx.role, pathKeys: Object.keys(ctx.paths || {}) });
    window.renderSidebar?.();
  } catch (error) {
    console.error('[csv-mapping] init failed', error);
    setStatus('初期設定に失敗しました。ログイン状態またはテナント設定を確認してください。', 'error');
    if (form) form.hidden = true;
    return;
  }

  if (!window.permissions?.canEditCsvMapping(window.appContext)) {
    setStatus('この機能は管理者向け機能です。現在実装中です。', 'error');
    form.hidden = true;
    return;
  }

  // 現行 appContext では tenantId 名で保持しているが、
  // 設計仕様上は clientId として扱う。
  const clientId = window.appContext.clientId || window.appContext.tenantId;
  const mappingRef = window.firestorePaths.csvMappingCurrent(clientId);

  const doc = await mappingRef.get();
  const data = doc.exists ? doc.data() : {};
  document.getElementById('hasHeader').checked = Boolean(data.hasHeader ?? true);
  const cols = data.columns || {};
  fields.forEach((key) => { document.getElementById(key).value = normalizeColumnValue(cols[key] || ''); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const hasHeader = document.getElementById('hasHeader').checked;
    const columns = {};
    fields.forEach((key) => {
      const normalized = normalizeColumnValue(document.getElementById(key).value);
      columns[key] = normalized;
      document.getElementById(key).value = normalized;
    });

    const invalidFields = fields.filter((key) => columns[key] && !isValidColumnLetter(columns[key]));
    if (invalidFields.length) return void setStatus(`列指定が不正です: ${invalidFields.join(', ')}。A, B, C, AA の形式で入力してください。`, 'error');

    if (!columns.pickingNo) return void setStatus('ピッキングNo.は必須です。', 'error');
    if (!columns.quantity) return void setStatus('数量は必須です。', 'error');
    if (!columns.jan && !columns.alternativeCode) return void setStatus('JANまたは代替コードのいずれかは必須です。', 'error');

    const usedColumns = fields.filter((key) => columns[key]).map((key) => columns[key]);
    const duplicates = [...new Set(usedColumns.filter((col, index) => usedColumns.indexOf(col) !== index))];
    if (duplicates.length) return void setStatus(`同じ列が複数項目に設定されています：${duplicates.join(', ')}`, 'error');

    try {
      const now = firebase.firestore.FieldValue.serverTimestamp();
      await mappingRef.set({ hasHeader, columns, updatedAt: now, updatedBy: window.appContext.uid }, { merge: true });

      const opRef = window.firestorePaths.operationLogs(clientId).doc();
      await opRef.set({
        logId: opRef.id,
        clientId,
        operationType: 'mapping_update',
        targetType: 'csvMapping',
        targetId: 'current',
        userId: window.appContext.uid,
        deviceId: localStorage.getItem('deviceId') || null,
        detail: { columns, hasHeader },
        operatedAt: now,
      });

      setStatus('CSVマッピングを保存しました。', 'success');
    } catch (error) {
      console.error('[csv-mapping] save failed', error);
      setStatus('CSVマッピングの保存に失敗しました。権限または通信状態を確認してください。', 'error');
    }
  });
})();
