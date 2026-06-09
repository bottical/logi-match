(function () {
  const WORK_MAX_DAYS = 31;
  const WORK_FETCH_LIMIT = 2000;
  const DETAIL_WORK_FETCH_LIMIT = 100;
  const DETAIL_ITEM_CONCURRENCY = 5;
  const SCAN_MAX_DAYS = 7;
  const SCAN_FETCH_LIMIT = 9999;
  const $ = (id) => document.getElementById(id);
  const statusEl = $('downloadStatus');
  const buttonIds = ['exportCompletedCsvButton', 'exportDetailCsvButton', 'exportScanLogCsvButton'];
  const buttons = buttonIds.map((id) => $(id)).filter(Boolean);
  let appCtx = null;
  let canUsePage = false;

  function showStatus(message, type) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.remove('status-message--error', 'status-message--success');
    if (type === 'error') statusEl.classList.add('status-message--error');
    if (type === 'success') statusEl.classList.add('status-message--success');
  }
  function setButtonsDisabled(disabled) { buttons.forEach((b) => { b.disabled = disabled; }); }
  function getClientId() { return appCtx?.clientId || appCtx?.tenantId || window.appContext?.clientId || window.appContext?.tenantId || ''; }
  function getInspectionWorksRef() {
    if (appCtx?.paths?.inspectionWorks?.where) return appCtx.paths.inspectionWorks;
    if (typeof appCtx?.paths?.inspectionWorks === 'function') return appCtx.paths.inspectionWorks(getClientId());
    return window.firestorePaths.inspectionWorks(getClientId());
  }
  function getScanLogsRef() {
    if (appCtx?.paths?.scanLogs?.where) return appCtx.paths.scanLogs;
    if (typeof appCtx?.paths?.scanLogs === 'function') return appCtx.paths.scanLogs(getClientId());
    return window.firestorePaths.scanLogs(getClientId());
  }
  function getOperationLogsRef() {
    if (appCtx?.paths?.operationLogs?.add) return appCtx.paths.operationLogs;
    if (typeof appCtx?.paths?.operationLogs === 'function') return appCtx.paths.operationLogs(getClientId());
    return window.firestorePaths.operationLogs(getClientId());
  }
  function getInspectionWorkItemsRef(workId) {
    if (typeof appCtx?.paths?.inspectionItems === 'function') return appCtx.paths.inspectionItems(workId, getClientId());
    if (typeof appCtx?.paths?.inspectionWorkItems === 'function') return appCtx.paths.inspectionWorkItems(getClientId(), workId);
    if (typeof appCtx?.paths?.inspectionWork === 'function') return appCtx.paths.inspectionWork(workId, getClientId()).collection('items');
    if (typeof window.firestorePaths.inspectionWorkItems === 'function') return window.firestorePaths.inspectionWorkItems(getClientId(), workId);
    return getInspectionWorksRef().doc(workId).collection('items');
  }
  function getDeviceId() { return localStorage.getItem('deviceId') || localStorage.getItem('inspectionDeviceId') || ''; }
      function formatDateTime(value) {
    if (!value) return '';
    const date = typeof value.toDate === 'function' ? value.toDate() : value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  }
    function csvEscape(value) {
    const s = value == null ? '' : String(value);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  function downloadCsv(filename, headers, rows) {
    const body = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  const toYYYYMMDD = (v) => String(v || '').replaceAll('-', '');
  async function logDownload(detail) {
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const userUid = appCtx?.user?.uid || appCtx?.uid || '';
    const userEmail = appCtx?.user?.email || appCtx?.email || '';
    await getOperationLogsRef().add({
      eventType: 'download',
      operationType: 'download', targetType: 'result_download', targetId: detail.downloadType || '',
      clientId: getClientId(),
      userUid,
      userEmail,
      workerId: '', workerNameSnapshot: '', userId: userUid, deviceId: getDeviceId(), detail,
      after: detail,
      createdAt: now,
      operatedAt: now,
    });
  }
  // Firestoreで複合インデックスが必要になる場合がある。
  // inspectionWorks: status Asc, completedAt Asc
  // Firebase Console にインデックス作成リンクが出た場合は、その内容に従って作成する。
  async function queryCompletedWorks(range, limit = WORK_FETCH_LIMIT, limitMessage = '対象件数が多すぎます。期間を短くして再度出力してください。') {
    const snap = await getInspectionWorksRef().where('status', '==', 'completed').where('completedAt', '>=', range.start).where('completedAt', '<', range.endExclusive).orderBy('completedAt', 'asc').limit(limit + 1).get();
    if (snap.size > limit) throw new Error(limitMessage);
    return snap.docs;
  }
  async function exportCompleted(range) {
    window.dateRangePolicy.assertRange(range, 'completed');
    const docs = await queryCompletedWorks(range);
    const rows = docs.map((doc) => {
      const w = doc.data() || {};
      return [w.pickingNo || '', w.status || '', w.destinationName || '', w.totalSkuCount || w.skuCount || 0, w.targetQtyTotal || 0, w.actualQtyTotal || 0, w.excludedItemCount || 0, formatDateTime(w.startedAt), formatDateTime(w.completedAt), w.completedWorkerName || w.currentWorkerName || w.workerNameSnapshot || w.workerName || '', w.importBatchId || '', w.importFileName || ''];
    });
    if (!rows.length) throw new Error('対象データがありません。日付条件を確認してください。');
    downloadCsv(`completed_works_${toYYYYMMDD(range.from)}_${toYYYYMMDD(range.to)}.csv`, ['ピッキングNo.', 'ステータス', 'お届け先名', 'SKU数', '検品対象数量合計', '実績数量合計', '検品対象外行数', '開始時刻', '完了時刻', '作業者', '取込バッチID', '取込ファイル名'], rows);
    await logDownload({ downloadType: 'completed_works', from: range.from, to: range.to, rowCount: rows.length });
    showStatus(`CSVを出力しました。（${rows.length}件）`, 'success');
  }
  function resolveItemStatus(item, target, actual) { if (item.itemStatus) return item.itemStatus; if (actual >= target) return 'completed'; if (actual > 0) return 'working'; return 'unstarted'; }
  async function runInBatches(items, size, worker) {
    const results = [];
    for (let i = 0; i < items.length; i += size) {
      const settled = await Promise.allSettled(items.slice(i, i + size).map(worker));
      results.push(...settled);
      showStatus(`明細CSVを取得中です。大量出力は非推奨です。（${Math.min(i + size, items.length)}/${items.length}作業）`);
    }
    return results;
  }
  async function exportDetails(range) {
    window.dateRangePolicy.assertRange(range, 'details');
    const works = await queryCompletedWorks(range, DETAIL_WORK_FETCH_LIMIT, `明細CSVの対象作業が${DETAIL_WORK_FETCH_LIMIT}件を超えています。明細CSVは大量出力非推奨のため、期間を短くして再度出力してください。`);
    showStatus(`明細CSVを取得中です。大量出力は非推奨です。（対象${works.length}作業、同時取得${DETAIL_ITEM_CONCURRENCY}件まで）`);
    const rows = [];
    const results = await runInBatches(works, DETAIL_ITEM_CONCURRENCY, async (workDoc) => {
      const work = workDoc.data() || {};
      const itemSnap = await getInspectionWorkItemsRef(workDoc.id).get();
      const workRows = [];
      itemSnap.forEach((itemDoc) => {
        const item = itemDoc.data() || {};
        const target = Number(item.targetQty ?? 0);
        const actual = Number(item.actualQty ?? 0);
        workRows.push([work.pickingNo || '', item.jan || '', item.alternativeCode || '', item.productName || '', target, actual, actual - target, item.inspectionRequired === false ? '検品対象外' : '検品対象', resolveItemStatus(item, target, actual), work.destinationName || '', work.slipNo || '', work.shipDate || '', work.shipperName || '', work.location || item.location || '', work.importFileName || '', formatDateTime(work.completedAt)]);
      });
      return workRows;
    });
    const rejected = results.filter((r) => r.status === 'rejected');
    if (rejected.length) throw new Error(`明細取得に失敗した作業が${rejected.length}件あります。期間を短くして再度お試しください。`);
    results.forEach((r) => { if (r.status === 'fulfilled') rows.push(...r.value); });
    if (!rows.length) throw new Error('対象データがありません。日付条件を確認してください。');
    downloadCsv(`inspection_details_${toYYYYMMDD(range.from)}_${toYYYYMMDD(range.to)}.csv`, ['ピッキングNo.', 'JAN', '代替コード', '商品名', '予定数量', '実績数量', '差異', '区分', 'ステータス', 'お届け先名', '伝票番号', '出荷日', '荷主名', 'ロケーション', '取込ファイル名', '完了時刻'], rows);
    await logDownload({ downloadType: 'details', from: range.from, to: range.to, workCount: works.length, rowCount: rows.length, workLimit: DETAIL_WORK_FETCH_LIMIT });
    showStatus(`CSVを出力しました。（${rows.length}件）`, 'success');
  }
  async function exportScanLogs(range) {
    window.dateRangePolicy.assertRange(range, 'scan');
    const snap = await getScanLogsRef().where('scannedAt', '>=', range.start).where('scannedAt', '<', range.endExclusive).orderBy('scannedAt', 'asc').limit(SCAN_FETCH_LIMIT + 1).get();
    if (snap.size > SCAN_FETCH_LIMIT) throw new Error('スキャンログ件数が多すぎます。期間を短くして再度出力してください。');
    const rows = snap.docs.map((doc) => { const l = doc.data() || {}; return [formatDateTime(l.scannedAt), l.scannedCode || '', l.codeType || '', l.currentPickingNo || '', l.pickingNo || '', l.result || '', l.errorMessage || '', l.inputQty || '', l.beforeQty || '', l.afterQty || '', l.targetQty || '', l.workerId || '', l.workerNameSnapshot || l.workerName || '', l.deviceId || '']; });
    if (!rows.length) throw new Error('対象データがありません。日付条件を確認してください。');
    downloadCsv(`scan_logs_${toYYYYMMDD(range.from)}_${toYYYYMMDD(range.to)}.csv`, ['日時', '読み込んだバーコード', 'コード種別', '現在作業中のピッキングNo.', '該当ピッキングNo.', '結果', 'エラー内容', '入力数量', '加算前数量', '加算後数量', '予定数量', '作業者ID', '作業者名', '端末ID'], rows);
    await logDownload({ downloadType: 'scan_logs', from: range.from, to: range.to, rowCount: rows.length });
    showStatus(`CSVを出力しました。（${rows.length}件）`, 'success');
  }
  async function runExport(type) {
    if (!canUsePage) return;
    setButtonsDisabled(true);
    showStatus('処理中です。しばらくお待ちください。');
    try {
      if (type === 'completed') await exportCompleted(window.dateRangePolicy.buildDateRange($('completedFrom')?.value, $('completedTo')?.value));
      else if (type === 'details') await exportDetails(window.dateRangePolicy.buildDateRange($('completedFrom')?.value, $('completedTo')?.value));
      else await exportScanLogs(window.dateRangePolicy.buildDateRange($('logFrom')?.value, $('logTo')?.value));
    } catch (e) {
      showStatus(e?.message || 'CSV出力に失敗しました。時間をおいて再度お試しください。', 'error');
    } finally {
      setButtonsDisabled(!canUsePage);
    }
  }

  setButtonsDisabled(true);
  window.appInit.ready('result-download').then((ctx) => {
    appCtx = ctx;
    window.renderSidebar?.();
    if (!getClientId()) throw new Error('テナント情報を取得できません。');
    canUsePage = !!window.permissions?.hasPermission?.('download_results', ctx);
    if (!canUsePage) showStatus('このページを利用する権限がありません。', 'error');
    setButtonsDisabled(!canUsePage);
  }).catch(() => {
    canUsePage = false;
    showStatus('初期設定に失敗しました。ログイン状態を確認してください。', 'error');
    setButtonsDisabled(true);
  });

  $('exportCompletedCsvButton')?.addEventListener('click', () => runExport('completed'));
  $('exportDetailCsvButton')?.addEventListener('click', () => runExport('details'));
  $('exportScanLogCsvButton')?.addEventListener('click', () => runExport('scan'));
})();
