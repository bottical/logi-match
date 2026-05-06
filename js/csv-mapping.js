(async function () {
  const statusEl = document.getElementById('mappingStatus');
  const form = document.getElementById('mappingForm');
  const fields = ['pickingNo', 'jan', 'alternativeCode', 'productName', 'quantity', 'destinationName', 'slipNo', 'shipDate', 'shipperName', 'location'];

  function isValidColumnLetter(value) {
    if (!value) return true;
    return /^[A-Z]+$/.test(value);
  }

  await window.initializeAppContext('csv-mapping');
  window.renderSidebar?.();

  if (!window.permissions?.canEditCsvMapping(window.appContext)) {
    statusEl.textContent = 'この機能は管理者向け機能です。現在実装中です。';
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
  fields.forEach((key) => { document.getElementById(key).value = cols[key] || ''; });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const hasHeader = document.getElementById('hasHeader').checked;
    const columns = {};
    fields.forEach((key) => {
      columns[key] = String(document.getElementById(key).value || '').trim().toUpperCase();
    });

    const invalidFields = fields.filter((key) => columns[key] && !isValidColumnLetter(columns[key]));
    if (invalidFields.length) return void (statusEl.textContent = `列指定が不正です: ${invalidFields.join(', ')}。A, B, C の形式で入力してください。`);

    if (!columns.pickingNo) return void (statusEl.textContent = 'ピッキングNo.列は必須です。');
    if (!columns.quantity) return void (statusEl.textContent = '数量列は必須です。');
    if (!columns.jan && !columns.alternativeCode) return void (statusEl.textContent = 'JAN列または代替コード列のいずれかは必須です。');

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

    statusEl.textContent = 'CSVマッピングを保存しました。';
  });
})();
