(function () {
  function getWorkIdFromState(state) {
    return state?.work?.work_id;
  }

  function getClientId() {
    const clientId = window.appContext?.clientId || window.appContext?.tenantId;
    if (!clientId) throw new Error('CLIENT_ID_MISSING');
    return clientId;
  }

  function getDb() {
    if (window.db) return window.db;
    if (window.firebase) return firebase.firestore();
    throw new Error('DB_UNAVAILABLE');
  }

  function getPaths() {
    const clientId = getClientId();
    if (window.appContext?.paths) return window.appContext.paths;
    if (window.firestorePaths?.createFirestorePaths) {
      return window.firestorePaths.createFirestorePaths(getDb(), clientId);
    }
    throw new Error('FIRESTORE_PATHS_MISSING');
  }

  function clientRef() {
    const clientId = getClientId();
    if (window.firestorePaths?.clientRoot) {
      return window.firestorePaths.clientRoot(clientId);
    }
    const paths = getPaths();
    if (typeof paths.client === 'function') return paths.client();
    if (typeof paths.clientRoot === 'function') return paths.clientRoot();
    return getDb().collection('clients').doc(clientId);
  }

  function inspectionWorksRef() {
    const clientId = getClientId();
    if (window.firestorePaths?.inspectionWorks) {
      return window.firestorePaths.inspectionWorks(clientId);
    }
    const paths = getPaths();
    if (typeof paths.inspectionWorks === 'function') return paths.inspectionWorks();
    return clientRef().collection('inspectionWorks');
  }

  function inspectionWorkRef(workId) {
    if (!workId) throw new Error('WORK_ID_MISSING');
    const clientId = getClientId();
    if (window.firestorePaths?.inspectionWork) {
      return window.firestorePaths.inspectionWork(clientId, workId);
    }
    const paths = getPaths();
    if (typeof paths.inspectionWork === 'function') return paths.inspectionWork(workId);
    return inspectionWorksRef().doc(workId);
  }

  function inspectionItemsRef(workId) {
    if (!workId) throw new Error('WORK_ID_MISSING');
    const clientId = getClientId();
    if (window.firestorePaths?.inspectionItems) {
      return window.firestorePaths.inspectionItems(clientId, workId);
    }
    const paths = getPaths();
    if (typeof paths.inspectionItems === 'function') return paths.inspectionItems(workId);
    return inspectionWorkRef(workId).collection('items');
  }

  function scanLogsRef() {
    const clientId = getClientId();
    if (window.firestorePaths?.scanLogs) {
      return window.firestorePaths.scanLogs(clientId);
    }
    const paths = getPaths();
    if (typeof paths.scanLogs === 'function') return paths.scanLogs();
    return clientRef().collection('scanLogs');
  }

  function operationLogsRef() {
    const clientId = getClientId();
    if (window.firestorePaths?.operationLogs) {
      return window.firestorePaths.operationLogs(clientId);
    }
    const paths = getPaths();
    if (typeof paths.operationLogs === 'function') return paths.operationLogs();
    return clientRef().collection('operationLogs');
  }

  async function writeScanLog(payload) {
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    await scanLogsRef().add({ scannedAt: now, ...payload });
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
        clientId: getClientId(),
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
          status:'current',
          currentWorkerId: worker.workerId,
          currentWorkerName: work.current_worker_name || worker.workerName || null,
          currentDeviceId: work.current_device_id || worker.deviceId || null,
          lockAcquiredAt: work.lock_acquired_at || now,
          startedAt: work.started_at || now,
          lastActivityAt: now,
          updatedAt: now,
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
          currentWorkerId: worker.workerId,
          currentWorkerName: worker.workerName || null,
          currentDeviceId: worker.deviceId || null,
          lockAcquiredAt: now,
          startedAt: work.started_at || now,
          lastActivityAt: now,
          updatedAt: now,
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
    if (!String(scannedCode || '').trim()) {
      await writeScanLog({ clientId:getClientId(), workId, scannedCode:'', codeType:'unknown', result:'invalid', errorMessage:'empty_code', workerId, workerNameSnapshot:workerName||null, userId:userId||null, deviceId:deviceId||null });
      return { ok:false, message:'invalid' };
    }
    const workRef = inspectionWorkRef(workId);
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const completedAtValue = now;
    return window.db.runTransaction(async (tx) => {
      const snap = await tx.get(workRef);
      if (!snap.exists) { tx.set(scanLogsRef().doc(),{clientId:getClientId(),workId,pickingNo:workId,scannedCode,result:'not_found',errorMessage:'work not found',codeType:'unknown',inputQty:Number(inputQty||0),beforeQty:null,afterQty:null,targetQty:null,workerId,workerNameSnapshot:workerName||null,userId:userId||null,deviceId:deviceId||null,scannedAt:now}); return { ok:false, message:'work not found' }; }
      const data=snap.data()||{}; const work=data.work||{}; const details=Array.isArray(data.details)?data.details:[];
      if(work.status==='completed'){ tx.set(scanLogsRef().doc(),{clientId:getClientId(),workId,pickingNo:work.pickingNo||work.picking_no||workId,scannedCode,result:'completed_work',errorMessage:'completed',codeType:'unknown',inputQty:Number(inputQty||0),beforeQty:null,afterQty:null,targetQty:null,workerId,workerNameSnapshot:workerName||null,userId:userId||null,deviceId:deviceId||null,scannedAt:now}); return {ok:false,message:'work is not current'};}
      if(work.status!=='current') { tx.set(scanLogsRef().doc(),{clientId:getClientId(),workId,pickingNo:work.pickingNo||work.picking_no||workId,scannedCode,result:'invalid',errorMessage:`work is not current: ${work.status || 'unknown'}`,codeType:'unknown',inputQty:Number(inputQty||0),beforeQty:null,afterQty:null,targetQty:null,workerId,workerNameSnapshot:workerName||null,userId:userId||null,deviceId:deviceId||null,scannedAt:now}); return {ok:false,message:'work is not current'}; }
      if(work.current_worker_id && work.current_worker_id!==workerId) { tx.set(scanLogsRef().doc(),{clientId:getClientId(),workId,pickingNo:work.pickingNo||work.picking_no||workId,scannedCode,result:'locked',errorMessage:'lock owner mismatch',codeType:'unknown',inputQty:Number(inputQty||0),beforeQty:null,afterQty:null,targetQty:null,workerId,workerNameSnapshot:workerName||null,userId:userId||null,deviceId:deviceId||null,scannedAt:now}); return {ok:false,message:'lock owner mismatch'}; }
      if(work.current_device_id && deviceId && work.current_device_id!==deviceId) { tx.set(scanLogsRef().doc(),{clientId:getClientId(),workId,pickingNo:work.pickingNo||work.picking_no||workId,scannedCode,result:'locked',errorMessage:'device mismatch',codeType:'unknown',inputQty:Number(inputQty||0),beforeQty:null,afterQty:null,targetQty:null,workerId,workerNameSnapshot:workerName||null,userId:userId||null,deviceId:deviceId||null,scannedAt:now}); return {ok:false,message:'device mismatch'}; }
      const norm=(v)=>String(v||'').trim();
      const tqty=(d)=>Number(d?.target_qty ?? d?.targetQty ?? 0);
      const aqty=(d)=>Number(d?.actual_qty ?? d?.actualQty ?? 0);
      const excluded=(d)=>d?.inspectionRequired===false||d?.inspection_required===false||tqty(d)===0;
      const scanKey=(d)=>[...(Array.isArray(d.scanKeys)?d.scanKeys:[]),{type:'jan',value:d.main_barcode||d.scan_code||d.jan},{type:'alternative',value:d.alt_code||d.alternativeCode},{type:'slipNo',value:d.slipNo}].map(k=>({type:k.type||'unknown',value:norm(k.value)})).filter(k=>k.value);
      const code=norm(scannedCode);
      let idx=-1, codeType='unknown';
      for(let i=0;i<details.length;i++){const d=details[i]; if(excluded(d)) continue; if(scanKey(d).some(k=>k.type==='jan'&&k.value===code)){idx=i;codeType='jan';break;}}
      if(idx<0){for(let i=0;i<details.length;i++){const d=details[i]; if(excluded(d)) continue; if(scanKey(d).some(k=>k.type==='alternative'&&k.value===code)){idx=i;codeType='alternative';break;}}}
      if(idx<0){for(let i=0;i<details.length;i++){const d=details[i]; if(excluded(d)) continue; if(scanKey(d).some(k=>k.type==='slipNo'&&k.value===code)){idx=i;codeType='slipNo';break;}}}
      if(idx<0) { tx.set(scanLogsRef().doc(),{clientId:getClientId(),workId,pickingNo:work.pickingNo||work.picking_no||workId,scannedCode:code,result:'not_found',errorMessage:'not found',codeType:'unknown',inputQty:Number(inputQty||0),beforeQty:null,afterQty:null,targetQty:null,workerId,workerNameSnapshot:workerName||null,userId:userId||null,deviceId:deviceId||null,scannedAt:now}); return {ok:false,message:'not found'}; }
      const d=details[idx]; const before=aqty(d); const target=tqty(d); const after=before+Number(inputQty||0);
      const detailId = d.detail_id || d.itemId || null;
      if(after>target) { tx.set(scanLogsRef().doc(),{clientId:getClientId(),workId,pickingNo:work.pickingNo||work.picking_no||workId,scannedCode:code,result:'over_qty',errorMessage:'over qty',codeType,inputQty:Number(inputQty||0),beforeQty:before,afterQty:after,targetQty:target,workerId,workerNameSnapshot:workerName||null,userId:userId||null,deviceId:deviceId||null,scannedAt:now}); return {ok:false,message:'over qty'}; }
      d.actual_qty = after;
      d.actualQty = after;
      d.completed_flag = after>=target;
      d.itemStatus = after>=target ? 'completed' : 'partial';
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
      tx.set(workRef,{details,work,status:work.status,actualQtyTotal:work.actualQtyTotal||0,lastActivityAt:new Date().toISOString(),updated_at:now,updatedAt:now,...(completed?{completedAt:completedAtValue,completed_at:completedAtValue,completedWorkerId:work.completedWorkerId||workerId||null,completedWorkerName:work.completedWorkerName||workerName||null,currentWorkerId:null,currentWorkerName:null,currentDeviceId:null}:{} )},{merge:true});
      if (detailId) {
        const itemRef = inspectionItemsRef(workId).doc(detailId);
        tx.set(itemRef,{actualQty:after,itemStatus:after>=target?'completed':'partial',updatedAt:now}, {merge:true});
      }
      const logRef = scanLogsRef().doc();
      const logId = logRef.id;
      tx.set(logRef,{logId,clientId:getClientId(),workId,pickingNo:work.pickingNo||work.picking_no||workId,scannedCode:code,codeType,result:'success',errorMessage:'',inputQty:Number(inputQty||0),beforeQty:before,afterQty:after,targetQty:target,workerId,workerNameSnapshot:workerName||null,userId:userId||null,deviceId:deviceId||null,scannedAt:now});
      if(completed){ const opRef=operationLogsRef().doc(); tx.set(opRef,{logId:opRef.id,clientId:getClientId(),operationType:'complete',targetType:'inspectionWork',targetId:workId,workerId:workerId||null,workerNameSnapshot:workerName||null,userId:userId||null,deviceId:deviceId||null,detail:{trigger:'scan-complete',scannedCode:code,detailId:d.detail_id||d.itemId||null},operatedAt:now}); }
      return {ok:true,detailId:d.detail_id||d.itemId||null,state:{work,details}};
    });
  };

  
  window.suspendInspectionWork = async function suspendInspectionWork(input) {
    const { workId, workerId, workerName, userId, deviceId, pickingNo, suspendedBy } = input || {};
    if (!workId) throw new Error('WORK_ID_MISSING');
    const workRef = inspectionWorkRef(workId);
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const batch = window.db.batch();
    batch.set(workRef, {
      status: 'suspended',
      suspendedAt: now,
      suspended_at: now,
      currentWorkerId: null,
      currentWorkerName: null,
      currentDeviceId: null,
      lockAcquiredAt: null,
      current_worker_id: null,
      current_worker_name: null,
      current_device_id: null,
      lock_acquired_at: null,
      updated_at: now,
      updatedAt: now,
      work: {
        status: 'suspended',
        suspended_at: now,
        suspendedAt: now,
        suspended_by: suspendedBy || userId || null,
        suspendedBy: suspendedBy || userId || null,
        currentWorkerId: null,
        currentWorkerName: null,
        currentDeviceId: null,
        lockAcquiredAt: null,
        current_worker_id: null,
        current_worker_name: null,
        current_device_id: null,
        lock_acquired_at: null,
        updatedAt: now,
        updated_at: now
      }
    }, { merge: true });
    const opRef = operationLogsRef().doc();
    batch.set(opRef, { logId: opRef.id, clientId: getClientId(), operationType: 'suspend', targetType: 'inspectionWork', targetId: workId, workerId: workerId || null, workerNameSnapshot: workerName || null, userId: userId || null, deviceId: deviceId || null, detail: { pickingNo: pickingNo || null }, operatedAt: now });
    await batch.commit();
  };

  window.resetInspectionWork = async function resetInspectionWork(input) {
    const { workId, workerId, workerName, userId, deviceId, pickingNo } = input || {};
    if (!workId) throw new Error('WORK_ID_MISSING');
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const workRef = inspectionWorkRef(workId);
    const itemsRef = inspectionItemsRef(workId);
    const itemSnaps = await itemsRef.get();
    const workSnap = await workRef.get();
    const details = Array.isArray((workSnap.data() || {}).details) ? (workSnap.data() || {}).details : [];
    const batch = window.db.batch();
    batch.set(workRef, {
      status: 'unstarted',
      completed_flag: false,
      completedFlag: false,
      actualQtyTotal: 0,
      actual_qty_total: 0,
      currentWorkerId: null,
      currentWorkerName: null,
      currentDeviceId: null,
      lockAcquiredAt: null,
      current_worker_id: null,
      current_worker_name: null,
      current_device_id: null,
      lock_acquired_at: null,
      startedAt: null,
      started_at: null,
      completedAt: null,
      completed_at: null,
      suspendedAt: null,
      suspended_at: null,
      completedWorkerId: null,
      completedWorkerName: null,
      updated_at: now,
      updatedAt: now,
      work: {
        status: 'unstarted', completed_flag: false, completedFlag: false, actualQtyTotal: 0, actual_qty_total: 0,
        currentWorkerId: null, currentWorkerName: null, currentDeviceId: null, lockAcquiredAt: null,
        current_worker_id: null, current_worker_name: null, current_device_id: null, lock_acquired_at: null,
        startedAt: null, started_at: null, completedAt: null, completed_at: null, suspendedAt: null, suspended_at: null,
        completedWorkerId: null, completedWorkerName: null, updatedAt: now, updated_at: now
      },
      details: details.map((d) => {
        const inspectionRequired = !(d?.inspectionRequired === false || d?.inspection_required === false || Number(d?.target_qty ?? d?.targetQty ?? 0) === 0);
        return { ...d, actual_qty: 0, actualQty: 0, completed_flag: false, completedFlag: false, itemStatus: inspectionRequired ? 'unstarted' : 'excluded' };
      })
    }, { merge: true });
    itemSnaps.forEach((doc) => {
      const data = doc.data() || {};
      const inspectionRequired = !(data?.inspectionRequired === false || data?.inspection_required === false || Number(data?.target_qty ?? data?.targetQty ?? 0) === 0);
      batch.set(doc.ref, { actualQty: 0, actual_qty: 0, completed_flag: false, completedFlag: false, itemStatus: inspectionRequired ? 'unstarted' : 'excluded', updatedAt: now, updated_at: now }, { merge: true });
    });
    const opRef = operationLogsRef().doc();
    batch.set(opRef, { logId: opRef.id, clientId: getClientId(), operationType: 'reset', targetType: 'inspectionWork', targetId: workId, workerId: workerId || null, workerNameSnapshot: workerName || null, userId: userId || null, deviceId: deviceId || null, detail: { pickingNo: pickingNo || null }, operatedAt: now });
    await batch.commit();
  };

  window.loadInspectionState = async function loadInspectionState(workId) {
    if (!window.db) {
      throw new Error('Firestore is not initialized.');
    }

    if (!workId) {
      throw new Error('work_id is missing.');
    }

    let doc = await inspectionWorkRef(workId).get();
    if (!doc.exists) {
      const byPickingNo = await inspectionWorksRef().where('pickingNo', '==', String(workId)).limit(1).get();
      if (!byPickingNo.empty) {
        doc = byPickingNo.docs[0];
      } else {
        const fallbackWorkId = String(workId).trim().replace(/\//g, '_');
        if (fallbackWorkId !== String(workId)) {
          const fallbackDoc = await inspectionWorkRef(fallbackWorkId).get();
          if (fallbackDoc.exists) doc = fallbackDoc;
        }
      }
    }

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
        work_id: doc.id || workId,
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



  function buildScanLog(input) {
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const ctx = window.appContext || {};
    const eventType = input.eventType || input.result || 'scan';
    const matchedType = input.matchedType || input.codeType || 'unknown';
    const qty = Number(input.qty ?? input.inputQty ?? 0);
    const beforeActualQty = input.beforeActualQty ?? input.beforeQty ?? null;
    const afterActualQty = input.afterActualQty ?? input.afterQty ?? null;
    const plannedQty = input.plannedQty ?? input.targetQty ?? null;
    const userUid = input.userUid || input.userId || ctx.uid || null;
    return {
      ...input,
      eventType,
      result: input.result || eventType,
      workId: input.workId || null,
      scannedCode: String(input.scannedCode || ''),
      matchedType,
      codeType: input.codeType || matchedType,
      itemId: input.itemId || null,
      qty,
      inputQty: input.inputQty ?? qty,
      beforeActualQty,
      beforeQty: input.beforeQty ?? beforeActualQty,
      afterActualQty,
      afterQty: input.afterQty ?? afterActualQty,
      plannedQty,
      targetQty: input.targetQty ?? plannedQty,
      workerId: input.workerId || null,
      workerNameSnapshot: input.workerNameSnapshot || null,
      userUid,
      userId: input.userId || userUid,
      userEmail: input.userEmail || ctx.email || null,
      clientId: getClientId(),
      createdAt: input.createdAt || now,
      scannedAt: input.scannedAt || now,
    };
  }
  function buildOperationLog(input) {
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const ctx = window.appContext || {};
    return {
      ...input,
      eventType: input.eventType || input.operationType || 'operation',
      targetType: input.targetType || 'inspectionWork',
      targetId: input.targetId || '',
      before: input.before || null,
      after: input.after || null,
      reason: input.reason || null,
      workerId: input.workerId || null,
      workerNameSnapshot: input.workerNameSnapshot || null,
      userUid: input.userUid || input.userId || ctx.uid || null,
      userEmail: input.userEmail || ctx.email || null,
      clientId: getClientId(),
      createdAt: input.createdAt || now,
      operatedAt: input.operatedAt || now,
    };
  }

  window.commitScanResult = async function commitScanResult(payload) {
    if (!window.db || !window.firebase?.firestore) throw new Error('Firestore is not initialized.');
    const { workId, pickingNo, itemId, scannedCode, inputQty, beforeQty, afterQty, targetQty, workCompleted, worker, deviceId } = payload || {};
    if (!workId) throw new Error('WORK_ID_MISSING');
    if (!itemId) throw new Error('ITEM_ID_MISSING');
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const workRef = inspectionWorkRef(workId);
    return window.db.runTransaction(async (tx) => {
      const snap = await tx.get(workRef);
      if (!snap.exists) throw new Error('WORK_NOT_FOUND');
      const data = snap.data() || {};
      const work = data.work || {};
      const details = Array.isArray(data.details) ? data.details : [];
      const idx = details.findIndex((d) => String(d.detail_id || d.itemId || '') === String(itemId));
      if (idx < 0) throw new Error('ITEM_NOT_FOUND');
      const item = details[idx];
      const currentQty = Number(item?.actual_qty ?? item?.actualQty ?? 0);
      if (Math.abs(currentQty - Number(beforeQty || 0)) > 0.0001) throw new Error('QTY_MISMATCH');
      const nextQty = Number(afterQty || 0);
      item.actual_qty = nextQty;
      item.actualQty = nextQty;
      item.completed_flag = nextQty >= Number(targetQty || 0);
      item.completedFlag = item.completed_flag;
      item.itemStatus = item.completed_flag ? 'completed' : (nextQty > 0 ? 'partial' : 'unstarted');
      const active = details.filter((d) => !(d?.inspectionRequired === false || d?.inspection_required === false || Number(d?.target_qty ?? d?.targetQty ?? 0) === 0));
      work.actualQtyTotal = active.reduce((n, d) => n + Number(d?.actual_qty ?? d?.actualQty ?? 0), 0);
      work.status = workCompleted ? 'completed' : 'current';
      work.completed_flag = !!workCompleted;
      work.lastActivityAt = new Date().toISOString();
      if (workCompleted) { work.completedAt = now; work.completed_at = now; }
      tx.set(workRef, { details, work, status: work.status, actualQtyTotal: work.actualQtyTotal || 0, lastActivityAt: new Date().toISOString(), updated_at: now, updatedAt: now, ...(workCompleted ? { completedAt: now, completed_at: now, completedWorkerId: worker?.workerId || null, completedWorkerName: worker?.workerName || null, currentWorkerId: null, currentWorkerName: null, currentDeviceId: null } : {}) }, { merge: true });
      const itemRef = inspectionItemsRef(workId).doc(String(itemId));
      tx.set(itemRef, {
        actualQty: nextQty,
        actual_qty: nextQty,
        completed_flag: item.completed_flag,
        completedFlag: item.completed_flag,
        itemStatus: item.itemStatus,
        updatedAt: now,
        updated_at: now
      }, { merge: true });
      const logRef = scanLogsRef().doc();
      tx.set(logRef, buildScanLog({ logId: logRef.id, eventType: 'scan_success', result: 'success', workId, pickingNo: pickingNo || work.pickingNo || work.picking_no || workId, scannedCode: String(scannedCode || ''), matchedType: 'unknown', qty: Number(inputQty || 0), beforeActualQty: Number(beforeQty || 0), afterActualQty: Number(afterQty || 0), plannedQty: Number(targetQty || 0), workerId: worker?.workerId || null, workerNameSnapshot: worker?.workerName || null, userUid: worker?.userId || null, deviceId: deviceId || null, scannedAt: now }));
      if (workCompleted) {
        const opRef = operationLogsRef().doc();
        tx.set(opRef, buildOperationLog({ logId: opRef.id, eventType: 'complete', operationType: 'complete', targetType: 'inspectionWork', targetId: workId, workerId: worker?.workerId || null, workerNameSnapshot: worker?.workerName || null, userUid: worker?.userId || null, deviceId: deviceId || null, after: { trigger: 'commit-scan-result', scannedCode: String(scannedCode || ''), detailId: itemId }, operatedAt: now }));
      }
    });
  };

  // scanLogs are treated as scan event logs in the initial release.
  // They do not strictly guarantee state update persistence in the same atomic transaction.
  window.appendScanLog = async function appendScanLog(workId, log) {
    if (!window.db || !window.firebase?.firestore) throw new Error('Firestore is not initialized.');
    if (!workId) throw new Error('work_id is missing.');
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const ref=scanLogsRef().doc();
    await ref.set(buildScanLog({ logId: ref.id, workId, ...log, scannedAt: log.scannedAt || now }));
  };
})();
