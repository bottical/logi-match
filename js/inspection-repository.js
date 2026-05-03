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

    // NOTE: details full-array save is a temporary structure for validation.
    // TODO: migrate to details subcollection for production scalability.
    // inspectionWorks/{work_id}/details/{detail_id}
    const payload = {
      work: { ...state.work, updated_at: now },
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

    const workRef = window.db.collection('inspectionWorks').doc(workId);
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

  // TODO(next phase): read work_id from inspection.html?work_id=... and load matching work.
  // TODO(next phase): fetch header and detail data from inspectionWorks/{work_id}.
  // TODO(next phase): migrate detail storage to subcollection details/{detail_id}.
  window.loadInspectionState = async function loadInspectionState(workId) {
    console.info('[inspection] loadInspectionState TODO', workId);
    return null;
  };
})();
