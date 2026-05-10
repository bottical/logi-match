(function(){
  const $=id=>document.getElementById(id);
  if (!$('importButton')) return; $('importButton').disabled=true; (async()=>{try{const ctx = await window.appInit.ready(document.body.dataset.page);console.debug("[app-init]",{page:document.body.dataset.page,hasAppInit:!!window.appInit,hasFirestorePaths:!!window.firestorePaths,clientId:ctx.clientId,role:ctx.role,pathKeys:Object.keys(ctx.paths||{})});window.renderSidebar?.();$('importButton').disabled=false;}catch(e){console.error('[master-import] init failed',e);$('importStatus').textContent='初期設定に失敗しました。ログイン状態またはテナント設定を確認してください。';}})();
  const db=()=>window.db;
  const requiredBase=['work_id','target_qty'];
  const nowIso=()=>new Date().toISOString();
  const dateKey=()=>new Date().toISOString().slice(0,10);
  const safe=s=>String(s||'').replace(/[^\w-]/g,'_');
  const BATCH_LIMIT=450;

  function sanitizeWorkId(pickingNo){
    return String(pickingNo||'').trim().replace(/\//g,'_');
  }

  async function deleteItemsByChunk(itemsRef){
    let snap=await itemsRef.limit(450).get();
    while(!snap.empty){
      let b=db().batch(); let c=0;
      snap.docs.forEach(doc=>{b.delete(doc.ref); c+=1;});
      await b.commit();
      snap=await itemsRef.limit(450).get();
    }
  }


  function columnLetterToIndex(letter){
    const value=String(letter||'').trim().toUpperCase();
    if(!value) return null;
    let index=0;
    for(let i=0;i<value.length;i+=1){
      const code=value.charCodeAt(i);
      if(code<65||code>90) throw new Error(`不正な列指定です: ${letter}`);
      index=index*26+(code-64);
    }
    return index-1;
  }

  function mapHeaders(headers){ const map={}; Object.entries(window.csvUtils.HEADER_ALIASES).forEach(([k,aliases])=>{ const i=headers.findIndex(h=>aliases.includes((h||'').trim())); if(i>=0) map[k]=i;}); return map; }
  function rowObj(row,map){ const o={}; Object.entries(map).forEach(([k,i])=>o[k]=(row[i]||'').trim()); return o; }

  async function loadCsvMapping(clientId){
    if(!window.firestorePaths?.csvMappingCurrent) return null;
    const snap=await window.firestorePaths.csvMappingCurrent(clientId).get();
    if(!snap.exists) return null;
    return snap.data()||null;
  }

  function convertMappingKeysToLegacyMap(mapping){
    const columns=mapping?.columns||{};
    const keyMap={pickingNo:'work_id',jan:'main_barcode',alternativeCode:'alt_code',productName:'product_name',quantity:'target_qty',destinationName:'recipient_name',slipNo:'slip_no',shipDate:'ship_date',shipperName:'shipper_name',location:'location'};
    const map={};
    Object.entries(keyMap).forEach(([newKey,legacyKey])=>{const index=columnLetterToIndex(columns[newKey]); if(index!==null&&index!==undefined) map[legacyKey]=index;});
    return map;
  }

  function renderMessages(id, rows){ const ul=$(id); ul.replaceChildren(); rows.forEach(r=>{const li=document.createElement('li'); li.textContent=r; ul.appendChild(li);}); }

  async function runImport(){
    if (!db()) return alert('Firebase未接続'); if(!window.appContext?.tenantId) return alert('テナント情報の取得が完了していません。再読み込みしてください。');
    const file=$('csvFile').files[0]; if(!file) return;
    $('importStatus').textContent='取込中...'; $('importResult').textContent=''; renderMessages('importErrors',[]); renderMessages('importWarnings',[]);
    const warnings=[]; const errors=[];
    try {
      const {text,encoding,warnings:dw}=window.csvUtils.decodeCsvArrayBuffer(await file.arrayBuffer()); warnings.push(...dw);
      const rows=window.csvUtils.parseCsv(text); if(rows.length<1) return fail('CSVとして読めない、またはデータがありません');
      // 現行 appContext では tenantId 名で保持しているが、設計仕様上は clientId として扱う。
      const clientId=window.appContext.clientId||window.appContext.tenantId;
      const mapping=await loadCsvMapping(clientId);
      const useMapping=Boolean(mapping?.columns);
      const inspectSlipNo=Boolean(mapping?.options?.inspectSlipNo);
      const map=useMapping?convertMappingKeysToLegacyMap(mapping):mapHeaders(rows[0]);
      const dataRows=useMapping?(mapping.hasHeader?rows.slice(1):rows):rows.slice(1);
      const miss=requiredBase.filter(k=>map[k]===undefined); const hasBarcodeHeader = map.main_barcode !== undefined || map.alt_code !== undefined; if(inspectSlipNo&&map.slip_no===undefined) miss.push('slip_no'); if(miss.length || !hasBarcodeHeader) return fail((useMapping?'CSVマッピング必須項目不足: ':'必須ヘッダ不足: ')+[...miss, ...(!hasBarcodeHeader ? ['main_barcode または alt_code'] : [])].join(','));
      const valid=[];
      dataRows.forEach((r,i)=>{ const n=(useMapping&&mapping.hasHeader===false)?i+1:i+2; const o=rowObj(r,map);
        const ng=(m)=>errors.push({row:n,reason:m,summary:`${o.work_id||''}/${o.product_id||''}/${o.product_name||''}`});
        if(!o.work_id) return ng('作業IDが空');
        if(!o.main_barcode && !o.alt_code) return ng('メインバーコード・代替コードが空');
        const q=Number(o.target_qty); if(!o.target_qty || !Number.isFinite(q) || q<=0) return ng('指示数が不正');
        if((o.excluded_flag||'').toUpperCase()==='ON' || o.excluded_flag==='1') return ng('対象外フラグON');
        if(inspectSlipNo && !o.slip_no) return ng('伝票番号が空');
        o.product_id=o.product_id||`AUTO-${o.work_id}-${n}`; o.product_name=o.product_name||''; o.recipient_name=o.recipient_name||''; o.target_qty=q; o.scan_code=o.main_barcode||o.alt_code; o.row_number=n; valid.push(o);
      });
      if(!valid.length) return fail('正常行が1件もありません');
      $('importStatus').textContent='既存作業ID確認中...';
      const batchId=`batch_${Date.now()}`; const grouped={}; valid.forEach(v=>(grouped[v.work_id]??=[]).push(v));
      let batch=db().batch(), writes=0, successWorks=0, successDetails=0;
      const commitBatchIfNeeded = async (force=false) => { if (writes>=BATCH_LIMIT || (force && writes>0)) { await batch.commit(); batch=db().batch(); writes=0; } };
      for (const [rawPickingNo,items] of Object.entries(grouped)) {
        const workId=sanitizeWorkId(rawPickingNo);
        const ref=window.firestorePaths.inspectionWork(clientId, workId);
        const snap=await ref.get();
        const currentStatus=snap.exists?((snap.data()||{}).status||'unstarted'):null;
        if (snap.exists && ['current','suspended','completed','deleted'].includes(currentStatus)) { warnings.push(`作業ID ${workId} は状態 ${currentStatus} のため上書きできません。`); continue; }

        if (snap.exists && currentStatus==='unstarted') {
          await commitBatchIfNeeded(true);
          await deleteItemsByChunk(window.firestorePaths.inspectionItems(clientId, workId));
        }

        const dmap=new Map();
        items.forEach(it=>{
          const key=(it.main_barcode||it.alt_code||'').trim();
          if(!dmap.has(key)) dmap.set(key,{itemId:`${safe(workId)}_${String(dmap.size+1).padStart(3,'0')}`,jan:it.main_barcode||'',alternativeCode:it.alt_code||'',scanKeys:[{type:'jan',value:it.main_barcode||''},{type:'alternative',value:it.alt_code||''}].filter(x=>x.value),productName:it.product_name||'',targetQty:0,actualQty:0,inspectionRequired:true,itemStatus:'unstarted',rowNumbers:[],warningMessages:[]});
          const d=dmap.get(key);
          d.targetQty+=it.target_qty; d.rowNumbers.push(it.row_number);
        });
        const details=[...dmap.values()];
        if (inspectSlipNo) {
          const slipMap = new Map();
          items.forEach((it) => {
            const slip = String(it.slip_no || '').trim();
            if (!slip) return;
            if (!slipMap.has(slip)) {
              slipMap.set(slip, {
                itemId: `${safe(workId)}_SLIP_${String(slipMap.size + 1).padStart(3, '0')}`,
                itemType: 'slip',
                jan: '',
                alternativeCode: '',
                slipNo: slip,
                scanKeys: [{ type: 'slipNo', value: slip }],
                productName: '伝票番号確認',
                targetQty: 1,
                actualQty: 0,
                inspectionRequired: true,
                itemStatus: 'unstarted',
                rowNumbers: [],
                warningMessages: []
              });
            }
            slipMap.get(slip).rowNumbers.push(it.row_number);
          });
          details.push(...slipMap.values());
        }
        const excludedItemCount=details.filter(x=>x.inspectionRequired===false).length;
        const targetQtyTotal=details.filter(x=>x.inspectionRequired!==false).reduce((n,x)=>n+Number(x.targetQty||0),0);
        const destinationName=items[0].recipient_name||'';
        const slipNo=items[0].slip_no||'';
        const shipDate=items[0].ship_date||null;
        const shipperName=items[0].shipper_name||'';
        const location=items[0].location||'';
        const nowTs=window.firebase.firestore.FieldValue.serverTimestamp();
        const nowIsoText = new Date().toISOString();
        const importDateKey = nowIsoText.slice(0, 10);
        const legacyDetails = details.map((item, index) => ({
          detail_id: item.itemId,
          itemId: item.itemId,
          work_id: workId,
          scan_code: item.jan || item.alternativeCode || item.slipNo || '',
          main_barcode: item.jan || '',
          alt_code: item.alternativeCode || '',
          jan: item.jan || '',
          alternativeCode: item.alternativeCode || '',
          slipNo: item.slipNo || '',
          scanKeys: item.scanKeys || [],
          product_id: item.productId || '',
          product_name: item.productName || '',
          productName: item.productName || '',
          target_qty: Number(item.targetQty || 0),
          targetQty: Number(item.targetQty || 0),
          actual_qty: 0,
          actualQty: 0,
          completed_flag: false,
          inspectionRequired: item.inspectionRequired !== false,
          itemStatus: item.inspectionRequired === false ? 'excluded' : 'unstarted',
          display_order_base: index + 1,
          rowNumbers: item.rowNumbers || [],
          source_rows: item.rowNumbers || [],
          warningMessages: item.warningMessages || [],
          created_at: nowIsoText,
          updated_at: nowIsoText
        }));
        const legacyWork = {
          work_id: workId, workId, pickingNo: rawPickingNo, picking_no: rawPickingNo,
          batch_id: batchId, importBatchId: batchId, source_file_name: file.name, importFileName: file.name,
          recipient_name: destinationName, destinationName, slipNo, shipDate, shipperName, location,
          import_date: nowIsoText, import_date_key: importDateKey,
          status: 'unstarted', current_worker_id: null, current_worker_name: null, current_device_id: null, current_started_at: null, lock_acquired_at: null,
          completed_flag: false, started_at: null, completed_at: null, completedAt: null, suspended_at: null,
          totalSkuCount: legacyDetails.filter(x => x.inspectionRequired !== false).length,
          targetQtyTotal: legacyDetails.filter(x => x.inspectionRequired !== false).reduce((n, x) => n + Number(x.target_qty || 0), 0),
          actualQtyTotal: 0,
          excludedItemCount: legacyDetails.filter(x => x.inspectionRequired === false).length,
          reset_count: 0, deleted_flag: false, created_at: nowIsoText, updated_at: nowIsoText
        };
        batch.set(ref,{workId,pickingNo:rawPickingNo,status:'unstarted',destinationName,slipNo,shipDate,shipperName,location,totalSkuCount:legacyWork.totalSkuCount,targetQtyTotal:legacyWork.targetQtyTotal,actualQtyTotal:0,excludedItemCount:legacyWork.excludedItemCount,importBatchId:batchId,importFileName:file.name,currentWorkerId:null,currentWorkerName:null,currentDeviceId:null,lockAcquiredAt:null,lastActivityAt:null,startedAt:null,completedAt:null,suspendedAt:null,createdAt:nowTs,updatedAt:nowTs,deleted_flag:false,work_id:workId,import_date:nowIsoText,import_date_key:importDateKey,work:legacyWork,details:legacyDetails,recentScan:null,importMeta:{batch_id:batchId,source_file_name:file.name,encoding},updated_at:nowTs},{merge:true});
        writes+=1;
        for (const item of details){
          batch.set(window.firestorePaths.inspectionItems(clientId, workId).doc(item.itemId),{...item,workId,pickingNo:rawPickingNo,createdAt:nowTs,updatedAt:nowTs});
          writes+=1;
          await commitBatchIfNeeded();
        }
        await commitBatchIfNeeded();
        successWorks+=1; successDetails+=details.length;
      }
      $('importStatus').textContent='Firestore保存中...'; await commitBatchIfNeeded(true);
      const totalWorks=Object.keys(grouped).length; const batchStatus = successWorks===0 ? 'failed' : ((errors.length||warnings.length||successWorks<totalWorks)?'partial_success':'success');
      await window.firestorePaths.importBatches(clientId).doc(batchId).set({batchId,batch_id:batchId,importedAt:window.firebase.firestore.FieldValue.serverTimestamp(),imported_at:window.firebase.firestore.FieldValue.serverTimestamp(),importedBy:window.auth?.currentUser?.email||'unknown-user',imported_by:window.auth?.currentUser?.email||'unknown-user',sourceFileName:file.name,source_file_name:file.name,encoding,status:batchStatus,successWorkCount:successWorks,success_work_count:successWorks,successDetailCount:successDetails,success_detail_count:successDetails,sourceRowCount:dataRows.length,source_row_count:dataRows.length,errorCount:errors.length,error_count:errors.length,warningCount:warnings.length,warning_count:warnings.length,errors,warnings});
      const opRef=window.firestorePaths.operationLogs(clientId).doc();
      await opRef.set({logId:opRef.id,clientId,operationType:'import',targetType:'importBatch',targetId:batchId,workerId:null,workerNameSnapshot:null,userId:window.appContext.uid,deviceId:localStorage.getItem('deviceId')||null,detail:{sourceFileName:file.name,sourceRowCount:dataRows.length,successWorkCount:successWorks,successDetailCount:successDetails,errorCount:errors.length,warningCount:warnings.length},operatedAt:window.firebase.firestore.FieldValue.serverTimestamp()});
      $('importStatus').textContent=successWorks===0?'取込失敗':'取込完了'; $('importResult').textContent=`バッチ:${batchId} 作業:${successWorks} 明細:${successDetails} エラー:${errors.length} 警告:${warnings.length}`;
      renderMessages('importErrors', errors.map(e=>`行${e.row}: ${e.reason} (${e.summary})`)); renderMessages('importWarnings', warnings);
    } catch (e) {
      console.error('[import] failed', e); fail(`取込失敗: ${e.message || e}`);
    }
    function fail(m){$('importStatus').textContent='取込失敗'; $('importResult').textContent=m;}
  }
  $('importButton').addEventListener('click',runImport);
})();
