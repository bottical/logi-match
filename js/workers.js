(async function () {
  const statusEl = document.getElementById('workersStatus');
  const bodyEl = document.getElementById('workersBody');

  function fmtDate(value) {
    if (!value) return '-';
    const dateValue = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    if (Number.isNaN(dateValue?.getTime?.())) return String(value);
    return dateValue.toLocaleString('ja-JP');
  }

  async function unlockCurrentWork(clientId, workDoc) {
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const workId = workDoc.__docId || workDoc.workId || workDoc.work_id || workDoc.work?.work_id;
    if (!workId) throw new Error('作業IDを特定できませんでした');

    const payload = {
      status: 'suspended',
      currentWorkerId: null,
      currentWorkerName: null,
      currentDeviceId: null,
      lockAcquiredAt: null,
      suspendedAt: now,
      updatedAt: now,
      work: {
        ...(workDoc.work || {}),
        status: 'suspended',
        current_worker_id: null,
        current_worker_name: null,
        current_login_uid: null,
        current_login_email: null,
        suspended_at: now,
        updated_at: now,
      },
      updated_at: now,
    };

    const workRef = window.firestorePaths.inspectionWork(clientId, workId);
    await firebase.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(workRef);
      if (!snap.exists) throw new Error('対象作業が存在しません');
      const latest = snap.data() || {};
      const latestStatus = latest.status || latest.work?.status;
      if (latestStatus !== 'current') throw new Error('対象作業は現在作業中ではありません');
      tx.set(workRef, payload, { merge: true });
    });

    const opRef = window.firestorePaths.operationLogs(clientId).doc();
    await opRef.set({
      logId: opRef.id,
      clientId,
      operationType: 'unlock_current',
      targetType: 'inspectionWork',
      targetId: workId,
      workerId: workDoc.currentWorkerId || workDoc.current_worker_id || workDoc.work?.current_worker_id || null,
      workerNameSnapshot: workDoc.currentWorkerName || workDoc.current_worker_name || workDoc.work?.current_worker_name || null,
      userId: window.appContext.uid,
      deviceId: localStorage.getItem('deviceId') || null,
      detail: { reason: 'workers_screen_unlock' },
      operatedAt: now,
    });
  }

  console.info('[workers] module loaded', {
    hasAppInit: typeof window.appInit?.ready === 'function',
    hasFirestorePaths: !!window.firestorePaths,
    hasDb: !!window.db,
  });

  let ctx;
  try {
    ctx = await window.appInit.ready(document.body.dataset.page);
    console.debug('[app-init]', { page: document.body.dataset.page, hasAppInit: !!window.appInit, hasFirestorePaths: !!window.firestorePaths, clientId: ctx.clientId, role: ctx.role, pathKeys: Object.keys(ctx.paths || {}) });
    window.renderSidebar?.();
  } catch (error) {
    console.error('[workers] init failed', error);
    if (statusEl) statusEl.textContent = '初期設定に失敗しました。ログイン状態またはテナント設定を確認してください。';
    return;
  }
  if (!window.permissions?.canViewAdminMenu(window.appContext)) {
    statusEl.textContent = 'この機能は管理者向け機能です。現在実装中です。';
    return;
  }

  // 現行 appContext では tenantId 名で保持しているが、
  // 設計仕様上は clientId として扱う。
  const clientId = window.appContext.clientId || window.appContext.tenantId;
  const workersSnap = await window.firestorePaths.workers(clientId).get();

  let currentWorksSnap = await window.firestorePaths.inspectionWorks(clientId).where('status', '==', 'current').get();
  const currentDocs = [];
  currentWorksSnap.forEach((doc) => {
    currentDocs.push({ id: doc.id, data: doc.data() || {} });
  });
  // 旧データ互換:
  // status がトップレベルではなく work.status にのみ存在するデータを暫定補完する。
  // データ移行完了後、この全件取得フォールバックは削除する。
  if (currentDocs.length === 0) {
    const allSnap = await window.firestorePaths.inspectionWorks(clientId).get();
    allSnap.forEach((doc) => {
      const data = doc.data() || {};
      if (data.work?.status === 'current') currentDocs.push({ id: doc.id, data });
    });
  }

  const currentByWorkerId = new Map();
  currentDocs.forEach(({ id, data }) => {
    const workerId = data.currentWorkerId || data.current_worker_id || data.work?.current_worker_id;
    if (workerId) currentByWorkerId.set(workerId, { ...data, __docId: id });
  });

  bodyEl.innerHTML = '';
  workersSnap.forEach((doc) => {
    const worker = doc.data() || {};
    const workerId = worker.workerId || doc.id;
    const current = currentByWorkerId.get(workerId);
    const workId = current?.__docId || current?.work_id || current?.work?.work_id || '-';
    const startedAt = current?.lockAcquiredAt || current?.work?.current_started_at || '-';
    const lastWorkedAt = worker.lastWorkedAt || worker.lastActivityAt || worker.updatedAt || '-';

    const disabled = worker.isActive === false || worker.active === false;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${worker.workerName || workerId}</td><td>${disabled ? '無効' : '有効'}</td><td>${workId}</td><td>${fmtDate(startedAt)}</td><td>${fmtDate(lastWorkedAt)}</td><td></td>`;
    const actionTd = tr.lastElementChild;

    if (current && window.permissions.canUnlockCurrent(window.appContext)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '作業中解除';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await unlockCurrentWork(clientId, current);
          statusEl.textContent = `${worker.workerName || workerId} の作業中を解除しました。`;
          window.location.reload();
        } catch (e) {
          console.error(e);
          statusEl.textContent = e.message || '作業中解除に失敗しました。';
          btn.disabled = false;
        }
      });
      actionTd.appendChild(btn);
    } else {
      actionTd.textContent = '-';
    }

    bodyEl.appendChild(tr);
  });

  statusEl.textContent = `${workersSnap.size}件`;
})();
