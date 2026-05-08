(function () {
  const MAX_EXPORT_DAYS = 31;
  const WORK_EXPORT_LIMIT = 1000;
  const SCAN_LOG_EXPORT_LIMIT = 3000;
  const $ = (id) => document.getElementById(id);
  const statusMap = { unstarted: '未着手', current: '作業中', suspended: '中断', completed: '完了' };
  const statusEl = $('downloadStatus');
  if (!statusEl) return;

  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;

  function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.classList.remove('status-message--error', 'status-message--success');
    if (type === 'error') statusEl.classList.add('status-message--error');
    if (type === 'success') statusEl.classList.add('status-message--success');
  }

  function clearStatus() {
    statusEl.textContent = '';
    statusEl.classList.remove('status-message--error', 'status-message--success');
  }

  function buildDateRangeFromInputs(fromId, toId, label) {
    const fromValue = $(fromId)?.value || '';
    const toValue = $(toId)?.value || '';
    if (!fromValue && !toValue) throw new Error(`${label}を指定してください。大量データ取得を防ぐため、日付条件なしの出力はできません。`);
    const startDateText = fromValue || toValue;
    const endDateText = toValue || fromValue;
    const start = new Date(`${startDateText}T00:00:00.000`);
    const end = new Date(`${endDateText}T23:59:59.999`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error(`${label}の指定が不正です。`);
    if (start.getTime() > end.getTime()) throw new Error(`${label}の開始日は終了日以前にしてください。`);
    const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    if (days > MAX_EXPORT_DAYS) throw new Error(`出力期間は最大${MAX_EXPORT_DAYS}日までです。期間を短くして再度出力してください。`);
    return { startDateText, endDateText };
  }

  async function queryInspectionWorks(clientId, range) {
    const base = window.firestorePaths.inspectionWorks(clientId);
    // NOTE: completedAt が Firestore Timestamp 型に統一された場合は fromDate() での比較へ変更する。
    const candidates = [
      { completedField: 'completedAt', statusField: 'status', label: 'new' },
      { completedField: 'work.completed_at', statusField: 'work.status', label: 'legacy-work' },
      { completedField: 'work.completed_at', statusField: 'status', label: 'legacy-mixed' }
    ];

    let lastError = null;
    for (const c of candidates) {
      try {
        const snap = await base
          .where(c.completedField, '>=', `${range.startDateText}T00:00:00.000`)
          .where(c.completedField, '<=', `${range.endDateText}T23:59:59.999`)
          .where(c.statusField, '==', 'completed')
          .limit(WORK_EXPORT_LIMIT)
          .get();
        const rows = snap.docs.map((d) => d.data());
        if (rows.length > 0) {
          console.debug('[result-download] query matched', c.label, rows.length);
          return rows;
        }
        console.debug('[result-download] query returned empty', c.label);
      } catch (error) {
        lastError = error;
        console.warn('[result-download] query candidate failed', c.label, error);
      }
    }
    if (lastError) {
      console.warn('[result-download] all query candidates failed or empty', lastError);
    }
    return [];
  }

  async function queryScanLogs(clientId, range) {
    const base = window.firestorePaths.scanLogs(clientId);
    const fields = ['scannedAt', 'scanned_at'];
    let lastError = null;
    for (const field of fields) {
      try {
        const snap = await base
          .where(field, '>=', `${range.startDateText}T00:00:00.000`)
          .where(field, '<=', `${range.endDateText}T23:59:59.999`)
          .limit(SCAN_LOG_EXPORT_LIMIT)
          .get();
        const rows = snap.docs.map((d) => d.data());
        if (rows.length > 0) {
          console.debug('[result-download] scanLogs query matched', field, rows.length);
          return rows;
        }
        console.debug('[result-download] scanLogs query returned empty', field);
      } catch (error) {
        lastError = error;
        console.warn('[result-download] scanLogs query failed', field, error);
      }
    }
    if (lastError) {
      console.warn('[result-download] scanLogs all query candidates failed or empty', lastError);
    }
    return [];
  }

  function downloadCsv(filename, headers, rows) {
    const lines = [headers.map(esc).join(',')];
    rows.forEach((row) => lines.push(row.map(esc).join(',')));
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function toWorkSummary(r) {
    const w = r.work || {};
    const details = Array.isArray(r.details) ? r.details : Array.isArray(w.details) ? w.details : [];
    return {
      workId: w.workId || w.work_id || r.workId || r.work_id || w.pickingNo || w.picking_no || r.pickingNo || r.picking_no || '',
      pickingNo: w.pickingNo || w.picking_no || w.work_id || r.pickingNo || r.work_id || '',
      status: w.status || r.status || '',
      destinationName: w.destinationName || w.recipient_name || r.destinationName || r.recipient_name || '',
      startedAt: w.startedAt || w.started_at || r.startedAt || r.started_at || '',
      completedAt: w.completedAt || w.completed_at || r.completedAt || r.completed_at || '',
      workerName: w.completed_worker_name || w.current_worker_name || w.current_worker_id || r.workerNameSnapshot || '',
      importFileName: w.importFileName || w.import_file_name || r.importFileName || r.import_file_name || '',
      totalSkuCount: Number(w.totalSkuCount ?? w.total_sku_count ?? r.totalSkuCount ?? r.total_sku_count ?? details.length ?? 0),
      targetQtyTotal: Number(w.targetQtyTotal ?? w.target_qty_total ?? r.targetQtyTotal ?? r.target_qty_total ?? 0),
      actualQtyTotal: Number(w.actualQtyTotal ?? w.actual_qty_total ?? r.actualQtyTotal ?? r.actual_qty_total ?? 0),
      excludedItemCount: Number(w.excludedItemCount ?? w.excluded_item_count ?? r.excludedItemCount ?? r.excluded_item_count ?? 0),
      details
    };
  }

  function toItemCsvRow(summary, item) {
    const scheduled = Number(item.targetQty ?? item.target_qty ?? 0);
    const actual = Number(item.actualQty ?? item.actual_qty ?? 0);
    const isExcluded =
      item.inspectionRequired === false ||
      item.inspection_target === false ||
      item.inspectionTarget === false ||
      item.itemStatus === 'excluded';

    return [
      summary.pickingNo,
      item.jan ?? item.jan_code ?? item.janCode ?? '',
      item.alternativeCode ?? item.alternative_code ?? item.alternate_code ?? item.alternateCode ?? '',
      item.productName ?? item.product_name ?? '',
      scheduled,
      actual,
      actual - scheduled,
      isExcluded ? '検品対象外' : '検品対象',
      statusMap[summary.status] || summary.status
    ];
  }

  async function exportCompletedWorksCsv(range) {
    const clientId = window.appContext.clientId || window.appContext.tenantId;
    if (!clientId) throw new Error('クライアント未取得');
    const rows = (await queryInspectionWorks(clientId, range)).filter((r) => r.deleted_flag !== true && r.work?.deleted_flag !== true);
    if (!rows.length) return showStatus('対象データがありませんでした。日付条件を確認してください。', 'error');

    const records = rows.map((r) => {
      const s = toWorkSummary(r);
      const detailTargetQty = s.details.reduce((n, x) => n + Number(x.target_qty ?? x.targetQty ?? x.targetQtyTotal ?? 0), 0);
      const detailActualQty = s.details.reduce((n, x) => n + Number(x.actual_qty ?? x.actualQty ?? 0), 0);
      const detailExcluded = s.details.filter((x) =>
        x.inspection_target === false ||
        x.inspectionTarget === false ||
        x.inspectionRequired === false ||
        x.itemStatus === 'excluded'
      ).length;
      const skuCount = s.details.length || s.totalSkuCount;
      const targetQty = s.details.length ? detailTargetQty : s.targetQtyTotal;
      const actualQty = s.details.length ? detailActualQty : s.actualQtyTotal;
      const excluded = s.details.length ? detailExcluded : s.excludedItemCount;
      return [s.pickingNo, statusMap[s.status] || s.status, s.destinationName, skuCount, targetQty, actualQty, excluded, s.startedAt, s.completedAt, s.workerName, s.importFileName];
    });

    downloadCsv('completed_works.csv', ['ピッキングNo.', 'ステータス', 'お届け先名', 'SKU数', '検品対象数量合計', '実績数量合計', '検品対象外行数', '開始時刻', '完了時刻', '作業者', '取込ファイル名'], records);
    if (rows.length >= WORK_EXPORT_LIMIT) {
      showStatus(`${WORK_EXPORT_LIMIT}件まで出力しました。対象データが多い可能性があります。期間を短くしてください。`, 'error');
      return;
    }
    showStatus('CSVを出力しました。', 'success');
  }

  async function exportDetailCsv(range) {
    const clientId = window.appContext.clientId || window.appContext.tenantId;
    if (!clientId) throw new Error('クライアント未取得');
    const works = await queryInspectionWorks(clientId, range);
    const rows = [];

    for (const work of works) {
      const summary = toWorkSummary(work);
      const legacyDetails = summary.details;
      if (legacyDetails.length) {
        legacyDetails.forEach((item) => {
          rows.push(toItemCsvRow(summary, item));
        });
        continue;
      }

      const workId = summary.workId;
      if (!window.firestorePaths.inspectionWorkItems || !workId) continue;
      const itemsSnap = await window.firestorePaths.inspectionWorkItems(clientId, workId).get();
      itemsSnap.forEach((doc) => {
        rows.push(toItemCsvRow(summary, doc.data() || {}));
      });
    }

    if (!rows.length) return showStatus('対象データがありませんでした。日付条件を確認してください。', 'error');
    downloadCsv('inspection_detail.csv', ['ピッキングNo.', 'JAN', '代替コード', '商品名', '予定数量', '実績数量', '差異', '区分', 'ステータス'], rows);
    showStatus('CSVを出力しました。', 'success');
  }

  async function exportScanLogsCsv(range) {
    if (!window.confirm('全スキャンログCSVは件数が多くなる場合があります。指定期間のログを出力しますか？')) return;
    const clientId = window.appContext.clientId || window.appContext.tenantId;
    if (!clientId) throw new Error('クライアント未取得');
    const logs = await queryScanLogs(clientId, range);
    if (!logs.length) return showStatus('対象データがありませんでした。日付条件を確認してください。', 'error');

    const rows = logs.map((log) => [
      log.scannedAt ?? log.scanned_at ?? '',
      log.scannedCode ?? log.barcode ?? log.scanned_code ?? '',
      log.codeType ?? log.code_type ?? '',
      log.currentPickingNo ?? log.current_work_id ?? '',
      log.pickingNo ?? log.matched_work_id ?? '',
      log.result ?? '',
      log.errorMessage ?? log.error_message ?? '',
      log.inputQty ?? log.input_qty ?? '',
      log.beforeQty ?? log.before_qty ?? '',
      log.afterQty ?? log.after_qty ?? '',
      log.targetQty ?? log.target_qty ?? '',
      log.workerId ?? log.worker_id ?? '',
      log.workerNameSnapshot ?? log.worker_name ?? '',
      log.deviceId ?? log.device_id ?? ''
    ]);

    downloadCsv('scan_logs.csv', ['日時', '読み込んだバーコード', 'コード種別', '現在作業中のピッキングNo.', '該当ピッキングNo.', '結果', 'エラー内容', '入力数量', '加算前数量', '加算後数量', '予定数量', '作業者ID', '作業者名', '端末ID'], rows);
    if (logs.length >= SCAN_LOG_EXPORT_LIMIT) {
      showStatus(`${SCAN_LOG_EXPORT_LIMIT}件まで出力しました。スキャンログが多い可能性があります。期間を短くしてください。`, 'error');
      return;
    }
    showStatus('CSVを出力しました。', 'success');
  }

  async function exportCsv(type) {
    clearStatus();
    try {
      if (!window.db) throw new Error('Firebase未接続');
      showStatus('CSVを作成しています。しばらくお待ちください。');
      if (type === 'completed') return exportCompletedWorksCsv(buildDateRangeFromInputs('completedFrom', 'completedTo', '検品完了日'));
      if (type === 'detail') return exportDetailCsv(buildDateRangeFromInputs('completedFrom', 'completedTo', '検品完了日'));
      if (type === 'scanLogs') return exportScanLogsCsv(buildDateRangeFromInputs('logFrom', 'logTo', 'スキャン日'));
      throw new Error('未対応のCSV種別です。');
    } catch (error) {
      console.error('[result-download] export failed', error);
      showStatus(error?.message || 'CSV出力に失敗しました。時間をおいて再度お試しください。', 'error');
    }
  }

  ['exportCompletedCsvButton', 'exportDetailCsvButton', 'exportScanLogCsvButton'].forEach((id) => { const b = $(id); if (b) b.disabled = true; });
  (async () => {
    try {
      const ctx = await window.appInit.ready(document.body.dataset.page);
      console.debug('[app-init]', { page: document.body.dataset.page, clientId: ctx.clientId, role: ctx.role });
      window.renderSidebar?.();
      ['exportCompletedCsvButton', 'exportDetailCsvButton', 'exportScanLogCsvButton'].forEach((id) => { const b = $(id); if (b) b.disabled = false; });
    } catch (e) {
      console.error('[result-download] init failed', e);
      showStatus('初期設定に失敗しました。ログイン状態またはテナント設定を確認してください。', 'error');
    }
  })();

  $('exportCompletedCsvButton')?.addEventListener('click', () => exportCsv('completed'));
  $('exportDetailCsvButton')?.addEventListener('click', () => exportCsv('detail'));
  $('exportScanLogCsvButton')?.addEventListener('click', () => exportCsv('scanLogs'));
})();
