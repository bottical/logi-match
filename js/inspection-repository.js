(function () {
  function getWorkIdFromState(state) {
    return state?.work?.work_id;
  }

  function getCurrentUserId() {
    const user = window.auth?.currentUser;
    return user?.email || user?.uid || 'unknown-user';
  }

  window.saveInspectionState = async function saveInspectionState(state, meta = {}) {
    if (!window.db || !window.firebase?.firestore) {
      throw new Error('Firestore is not initialized.');
    }

    const workId = getWorkIdFromState(state);
    if (!workId) {
      throw new Error('work_id is missing.');
    }

    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const workRef = window.db.collection('inspectionWorks').doc(workId);
    const existing = await workRef.get();
    const existingData = existing.exists ? (existing.data() || {}) : {};
    const resolvedImportDate = state.work.import_date || existingData.import_date || existingData.work?.import_date || null;
    const resolvedImportDateKey = state.work.import_date_key || existingData.import_date_key || existingData.work?.import_date_key || null;

    // NOTE: details full-array save is a temporary structure for validation.
    // TODO: migrate to details subcollection for production scalability.
    // inspectionWorks/{work_id}/details/{detail_id}
    const payload = {
      work_id: workId,
      status: state.work.status || 'unstarted',
      deleted_flag: !!state.work.deleted_flag,
      ...(resolvedImportDate ? { import_date: resolvedImportDate } : {}),
      ...(resolvedImportDateKey ? { import_date_key: resolvedImportDateKey } : {}),
      work: { ...state.work, import_date: resolvedImportDate, import_date_key: resolvedImportDateKey, updated_at: now },
      details: state.details,
      recentScan: state.recentScan ? {
        scanCode: state.recentScan.scanCode,
        detail_id: state.recentScan.detail?.detail_id || null,
        isAlt: !!state.recentScan.isAlt,
        at: state.recentScan.at || Date.now()
      } : null,
      syncMeta: {
        reason: meta.reason || 'unknown',
        payload: meta.payload || {},
        saved_by: getCurrentUserId(),
        saved_at: now
      },
      updated_at: now
    };

    const batch = window.db.batch();
    batch.set(workRef, payload, { merge: true });

    if (meta.reason === 'scan') {
      const logRef = workRef.collection('scanLogs').doc();
      batch.set(logRef, {
        work_id: workId,
        detail_id: meta.payload?.detailId || null,
        scanned_code: meta.payload?.scanCode || null,
        qty_delta: meta.payload?.qtyDelta || 1,
        result: 'accepted',
        worker_id: getCurrentUserId(),
        created_at: now
      });
    }

    if (meta.reason === 'scan' && state.work.completed_flag) {
      const opRef = workRef.collection('operationLogs').doc();
      batch.set(opRef, {
        work_id: workId,
        op_type: 'complete',
        worker_id: getCurrentUserId(),
        payload: { trigger: 'scan-complete', detail_id: meta.payload?.detailId || null },
        created_at: now
      });
    }

    if (['suspend', 'reset', 'complete'].includes(meta.reason)) {
      const opRef = workRef.collection('operationLogs').doc();
      batch.set(opRef, {
        work_id: workId,
        op_type: meta.reason,
        worker_id: getCurrentUserId(),
        payload: meta.payload || {},
        created_at: now
      });
    }

    await batch.commit();
  };



  window.acquireWorkLock = async function acquireWorkLock(workId, workerId) {
    if (!window.db || !window.firebase?.firestore) {
      throw new Error('Firestore is not initialized.');
    }
    if (!workId) {
      throw new Error('work_id is missing.');
    }
    if (!workerId) {
      throw new Error('workerId is missing.');
    }

    const workRef = window.db.collection('inspectionWorks').doc(workId);
    const now = window.firebase.firestore.FieldValue.serverTimestamp();

    return window.db.runTransaction(async (tx) => {
      const snap = await tx.get(workRef);
      if (!snap.exists) {
        return { ok: false, reason: 'not-found' };
      }

      const data = snap.data() || {};
      const work = data.work || {};
      const status = work.status || 'unstarted';
      const currentWorkerId = work.current_worker_id || null;

      if (status === 'completed') {
        return { ok: false, reason: 'completed' };
      }

      if (status === 'current' && currentWorkerId && currentWorkerId !== workerId) {
        return {
          ok: false,
          reason: 'locked',
          workerId: currentWorkerId,
          startedAt: work.current_started_at || null
        };
      }

      if (status === 'current' && currentWorkerId === workerId) {
        return { ok: true, reason: 'same-worker' };
      }

      if (status === 'unstarted' || status === 'suspended') {
        tx.set(workRef, {
          work_id: workId,
          status: 'current',
          deleted_flag: !!work.deleted_flag,
          work: {
            ...work,
            status: 'current',
            current_worker_id: workerId,
            current_started_at: now,
            updated_at: now
          },
          updated_at: now
        }, { merge: true });
        return { ok: true, reason: 'acquired' };
      }

      return { ok: false, reason: 'locked', workerId: currentWorkerId, startedAt: work.current_started_at || null };
    });
  };

  window.loadInspectionState = async function loadInspectionState(workId) {
    if (!window.db) {
      throw new Error('Firestore is not initialized.');
    }

    if (!workId) {
      throw new Error('work_id is missing.');
    }

    const doc = await window.db.collection('inspectionWorks').doc(workId).get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data();
    const details = Array.isArray(data.details) ? data.details : [];
    const recentScan = data.recentScan ? { ...data.recentScan } : null;

    if (recentScan?.detail_id) {
      recentScan.detail = details.find((d) => d.detail_id === recentScan.detail_id) || null;
    }

    return {
      work: data.work || {
        work_id: workId,
        recipient_name: '',
        status: 'unstarted',
        current_worker_id: null,
        completed_flag: false
      },
      details,
      recentScan,
      syncStatus: 'saved',
      lock: { locked: false, reason: null, worker_id: null, started_at: null },
      qtyMode: { enabled: false, qty: 1 }
    };
  };
})();
