(function () {
  function getWorkIdFromState(state) {
    return state?.work?.work_id;
  }

  function requireClientId() {
    const clientId = window.appContext?.clientId || window.appContext?.tenantId;
    if (!clientId) throw new Error('CLIENT_ID_MISSING');
    return clientId;
  }

  function clientRef() { return window.firestorePaths.clientRoot(requireClientId()); }

  function inspectionWorkRef(workId) {
    return clientRef().collection('inspectionWorks').doc(workId);
  }

  function scanLogsRef() {
    return clientRef().collection('scanLogs');
  }

  function operationLogsRef() {
    return clientRef().collection('operationLogs');
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
    const workRef = inspectionWorkRef(workId);
    const existing = await workRef.get();
    const existingData = existing.exists ? (existing.data() || {}) : {};
    const resolvedImportDate = state.work.import_date || existingData.import_date || existingData.work?.import_date || null;
    const resolvedImportDateKey = state.work.import_date_key || existingData.import_date_key || existingData.work?.import_date_key || null;

    // TODO(v1.1):
    // 設計仕様では inspectionWorks/{workId}/items/{itemId} のサブコレクション構造を想定している。
    // 現行実装は検品実行画面との互換性のため、details 配列を inspectionWorks ドキュメント内に保持している。
    // サブコレクション化は repository 層の移行計画を作成してから実施する。
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

    if (['suspend', 'reset', 'complete'].includes(meta.reason)) {
      const opRef = operationLogsRef().doc();
      batch.set(opRef, {
        logId: opRef.id,
        clientId: requireClientId(),
        operationType: meta.reason,
        targetType: 'inspectionWork',
        targetId: workId,
        workerId: getCurrentUserId(),
        workerNameSnapshot: null,
        userId: getCurrentUserId(),
        deviceId: window.appContext?.deviceId || 'web',
        detail: meta.payload || {},
        operatedAt: now
      });
    }

    await batch.commit();
  };



  window.acquireWorkLock = async function acquireWorkLock(workId, worker) {
    if (!window.db || !window.firebase?.firestore) {
      throw new Error('Firestore is not initialized.');
    }
    if (!workId) {
      throw new Error('work_id is missing.');
    }
    if (!worker?.workerId) {
      throw new Error('workerId is missing.');
    }

    const workRef = inspectionWorkRef(workId);
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

      if (status === 'current' && currentWorkerId && currentWorkerId !== worker.workerId) {
        return {
          ok: false,
          reason: 'locked',
          workerId: currentWorkerId,
          startedAt: work.current_started_at || null
        };
      }

      if (status === 'current' && currentWorkerId === worker.workerId) {
        tx.set(workRef,{
          work:{
            ...work,
            current_worker_id: worker.workerId,
            current_worker_name: work.current_worker_name || worker.workerName || null,
            current_login_uid: work.current_login_uid || worker.loginUid || null,
            current_login_email: work.current_login_email || worker.loginEmail || null,
            updated_at: now
          },
          updated_at: now
        },{merge:true});
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
            current_worker_id: worker.workerId,
            current_worker_name: worker.workerName || null,
            current_login_uid: worker.loginUid || null,
            current_login_email: worker.loginEmail || null,
            started_at: work.started_at || now,
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


  window.applyScanTransaction = async function applyScanTransaction(input) {
    const { workId, scannedCode, inputQty, workerId, workerName, userId, deviceId } = input;
    const workRef = inspectionWorkRef(workId);
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const completedAtValue = now;
    return window.db.runTransaction(async (tx) => {
      const snap = await tx.get(workRef);
      if (!snap.exists) return { ok:false, message:'work not found' };
      const data=snap.data()||{}; const work=data.work||{}; const details=Array.isArray(data.details)?data.details:[];
      if(work.status!=='current') return {ok:false,message:'work is not current'};
      if(work.current_worker_id && work.current_worker_id!==workerId) return {ok:false,message:'lock owner mismatch'};
      if(work.current_device_id && deviceId && work.current_device_id!==deviceId) return {ok:false,message:'device mismatch'};
      const norm=(v)=>String(v||'').trim();
      const tqty=(d)=>Number(d?.target_qty ?? d?.targetQty ?? 0);
      const aqty=(d)=>Number(d?.actual_qty ?? d?.actualQty ?? 0);
      const excluded=(d)=>d?.inspectionRequired===false||d?.inspection_required===false||tqty(d)===0;
      const scanKey=(d)=>[...(Array.isArray(d.scanKeys)?d.scanKeys:[]),{type:'jan',value:d.main_barcode||d.scan_code||d.jan},{type:'alternative',value:d.alt_code||d.alternativeCode}].map(k=>({type:k.type||'unknown',value:norm(k.value)})).filter(k=>k.value);
      const code=norm(scannedCode);
      let idx=-1, codeType='unknown';
      for(let i=0;i<details.length;i++){const d=details[i]; if(excluded(d)) continue; if(scanKey(d).some(k=>k.type==='jan'&&k.value===code)){idx=i;codeType='jan';break;}}
      if(idx<0){for(let i=0;i<details.length;i++){const d=details[i]; if(excluded(d)) continue; if(scanKey(d).some(k=>k.type==='alternative'&&k.value===code)){idx=i;codeType='alternative';break;}}}
      if(idx<0) return {ok:false,message:'not found'};
      const d=details[idx]; const before=aqty(d); const target=tqty(d); const after=before+Number(inputQty||0);
      if(after>target) return {ok:false,message:'over qty'};
      if(Object.prototype.hasOwnProperty.call(d,'actual_qty')) d.actual_qty=after; else d.actualQty=after;
      d.completed_flag = after>=target;
      const active=details.filter(x=>!excluded(x));
      const completed=active.every(x=>x.completed_flag);
      work.totalSkuCount = active.length;
      work.targetQtyTotal = active.reduce((n,x)=>n+tqty(x),0);
      work.actualQtyTotal = active.reduce((n,x)=>n+aqty(x),0);
      work.excludedItemCount = details.length - active.length;
      work.status=completed?'completed':'current';
      work.completed_flag=completed;
      if(completed){ work.completed_at = completedAtValue; work.completedAt = completedAtValue; work.completedWorkerId = workerId||work.current_worker_id||work.currentWorkerId||null; work.completedWorkerName = workerName||work.current_worker_name||work.currentWorkerName||null; work.current_worker_id=null; work.current_worker_name=null; work.current_login_uid=null; work.current_login_email=null; work.current_device_id=null; work.lock_acquired_at=null; work.current_started_at=null; work.currentWorkerId=null; work.currentWorkerName=null; work.currentDeviceId=null; work.lockAcquiredAt=null; }
      work.lastActivityAt=new Date().toISOString();
      tx.set(workRef,{details,work,status:work.status,updated_at:now,updatedAt:now,...(completed?{completedAt:completedAtValue,completed_at:completedAtValue,completedWorkerId:work.completedWorkerId||workerId||null,completedWorkerName:work.completedWorkerName||workerName||null}:{} )},{merge:true});
      const logRef = scanLogsRef().doc();
      const logId = logRef.id;
      tx.set(logRef,{logId,clientId:requireClientId(),workId,pickingNo:work.pickingNo||work.picking_no||workId,scannedCode:code,codeType,result:'success',errorMessage:'',inputQty:Number(inputQty||0),beforeQty:before,afterQty:after,targetQty:target,workerId,workerNameSnapshot:workerName||null,userId:userId||null,deviceId:deviceId||null,scannedAt:now});
      if(completed){ const opRef=operationLogsRef().doc(); tx.set(opRef,{logId:opRef.id,clientId:requireClientId(),operationType:'complete',targetType:'inspectionWork',targetId:workId,workerId:workerId||null,workerNameSnapshot:workerName||null,userId:userId||null,deviceId:deviceId||null,detail:{trigger:'scan-complete',scannedCode:code,detailId:d.detail_id||null},operatedAt:now}); }
      return {ok:true,detailId:d.detail_id,state:{work,details}};
    });
  };

  window.loadInspectionState = async function loadInspectionState(workId) {
    if (!window.db) {
      throw new Error('Firestore is not initialized.');
    }

    if (!workId) {
      throw new Error('work_id is missing.');
    }

    const doc = await inspectionWorkRef(workId).get();

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

  // scanLogs are treated as scan event logs in the initial release.
  // They do not strictly guarantee state update persistence in the same atomic transaction.
  window.appendScanLog = async function appendScanLog(workId, log) {
    if (!window.db || !window.firebase?.firestore) throw new Error('Firestore is not initialized.');
    if (!workId) throw new Error('work_id is missing.');
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const ref=scanLogsRef().doc();
    await ref.set({ logId: ref.id, clientId: requireClientId(), workId, ...log, scannedAt: log.scannedAt || now });
  };
})();
