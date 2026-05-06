(function(){
  const $=id=>document.getElementById(id);
  if (!$('importButton')) return; $('importButton').disabled=true; (async()=>{try{await window.initializeAppContext('master-import');window.renderSidebar?.();$('importButton').disabled=false;}catch(e){console.error('[master-import] init failed',e);$('importStatus').textContent='初期化に失敗しました。';}})();
  const db=()=>window.db;
  const requiredBase=['work_id','target_qty'];
  const nowIso=()=>new Date().toISOString();
  const dateKey=()=>new Date().toISOString().slice(0,10);
  const safe=s=>String(s||'').replace(/[^\w-]/g,'_');
  const BATCH_LIMIT=400;


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
      const map=useMapping?convertMappingKeysToLegacyMap(mapping):mapHeaders(rows[0]);
      const dataRows=useMapping?(mapping.hasHeader?rows.slice(1):rows):rows.slice(1);
      const miss=requiredBase.filter(k=>map[k]===undefined); const hasBarcodeHeader = map.main_barcode !== undefined || map.alt_code !== undefined; if(miss.length || !hasBarcodeHeader) return fail((useMapping?'CSVマッピング必須項目不足: ':'必須ヘッダ不足: ')+[...miss, ...(!hasBarcodeHeader ? ['main_barcode または alt_code'] : [])].join(','));
      const valid=[];
      dataRows.forEach((r,i)=>{ const n=(useMapping&&mapping.hasHeader===false)?i+1:i+2; const o=rowObj(r,map);
        const ng=(m)=>errors.push({row:n,reason:m,summary:`${o.work_id||''}/${o.product_id||''}/${o.product_name||''}`});
        if(!o.work_id) return ng('作業IDが空');
        if(!o.main_barcode && !o.alt_code) return ng('メインバーコード・代替コードが空');
        const q=Number(o.target_qty); if(!o.target_qty || !Number.isFinite(q) || q<=0) return ng('指示数が不正');
        if((o.excluded_flag||'').toUpperCase()==='ON' || o.excluded_flag==='1') return ng('対象外フラグON');
        o.product_id=o.product_id||`AUTO-${o.work_id}-${n}`; o.product_name=o.product_name||''; o.recipient_name=o.recipient_name||''; o.target_qty=q; o.scan_code=o.main_barcode||o.alt_code; o.row_number=n; valid.push(o);
      });
      if(!valid.length) return fail('正常行が1件もありません');
      $('importStatus').textContent='既存作業ID確認中...';
      const batchId=`batch_${Date.now()}`; const grouped={}; valid.forEach(v=>(grouped[v.work_id]??=[]).push(v));
      let batch=db().batch(), writes=0, successWorks=0, successDetails=0;
      const commitBatchIfNeeded = async (force=false) => { if (writes>=BATCH_LIMIT || (force && writes>0)) { await batch.commit(); batch=db().batch(); writes=0; } };
      for (const [workId,items] of Object.entries(grouped)) {
        const ref=window.firestorePaths.inspectionWork(clientId, workId); const snap=await ref.get();
        if (snap.exists && snap.data()?.deleted_flag!==true && snap.data()?.work?.deleted_flag!==true) { warnings.push(`作業ID ${workId} は既に存在するため取り込みませんでした。再取込する場合は管理者が既存作業を削除してください。`); continue; }
        const dmap=new Map();
        items.forEach(it=>{ const key=it.scan_code; if(!dmap.has(key)) dmap.set(key,{detail_id:`${safe(workId)}_${String(dmap.size+1).padStart(3,'0')}`,work_id:workId,scan_code:key,main_barcode:it.main_barcode||'',alt_code:it.alt_code||'',product_id:it.product_id,product_name:it.product_name,target_qty:0,actual_qty:0,completed_flag:false,display_order_base:dmap.size+1,source_rows:[],created_at:nowIso(),updated_at:nowIso()}); const d=dmap.get(key); d.target_qty+=it.target_qty; d.source_rows.push(it.row_number); if(d.product_id!==it.product_id||d.product_name!==it.product_name) warnings.push(`作業ID ${workId} / コード ${key} で商品情報不一致`); });
        // TODO(v1.1):
        // 設計仕様では inspectionWorks/{workId}/items/{itemId} のサブコレクション構造を想定している。
        // 現行実装は検品実行画面との互換性のため、details 配列を inspectionWorks ドキュメント内に保持している。
        // サブコレクション化は repository 層の移行計画を作成してから実施する。
        const details=[...dmap.values()]; const importDate=nowIso(); const importDateKey=dateKey();
        batch.set(ref,{work_id:workId,status:'unstarted',import_date:importDate,import_date_key:importDateKey,deleted_flag:false,work:{work_id:workId,batch_id:batchId,recipient_name:items[0].recipient_name||'',import_date:importDate,import_date_key:importDateKey,shipment_date:items[0].shipment_date||null,status:'unstarted',current_worker_id:null,current_started_at:null,completed_flag:false,started_at:null,completed_at:null,suspended_at:null,reset_count:0,deleted_flag:false,created_at:importDate,updated_at:importDate},details,recentScan:null,importMeta:{batch_id:batchId,source_file_name:file.name,encoding},updated_at:window.firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
        writes++; await commitBatchIfNeeded(); successWorks++; successDetails+=details.length;
      }
      $('importStatus').textContent='Firestore保存中...'; await commitBatchIfNeeded(true);
      const totalWorks=Object.keys(grouped).length; const batchStatus = successWorks===0 ? 'failed' : ((errors.length||warnings.length||successWorks<totalWorks)?'partial_success':'success');
      await window.firestorePaths.importBatches(clientId).doc(batchId).set({batch_id:batchId,imported_at:window.firebase.firestore.FieldValue.serverTimestamp(),imported_by:window.auth?.currentUser?.email||'unknown-user',source_file_name:file.name,encoding,status:batchStatus,success_work_count:successWorks,success_detail_count:successDetails,source_row_count:dataRows.length,error_count:errors.length,warning_count:warnings.length,errors,warnings});
      const opRef=window.firestorePaths.operationLogs(clientId).doc();
      await opRef.set({logId:opRef.id,clientId,operationType:'import',targetType:'importBatch',targetId:batchId,workerId:null,workerNameSnapshot:null,userId:window.appContext.uid,deviceId:localStorage.getItem('deviceId')||null,detail:{fileName:file.name,encoding,status:batchStatus,successWorkCount:successWorks,successDetailCount:successDetails,errorCount:errors.length,warningCount:warnings.length},operatedAt:window.firebase.firestore.FieldValue.serverTimestamp()});
      $('importStatus').textContent=successWorks===0?'取込失敗':'取込完了'; $('importResult').textContent=`バッチ:${batchId} 作業:${successWorks} 明細:${successDetails} エラー:${errors.length} 警告:${warnings.length}`;
      renderMessages('importErrors', errors.map(e=>`行${e.row}: ${e.reason} (${e.summary})`)); renderMessages('importWarnings', warnings);
    } catch (e) {
      console.error('[import] failed', e); fail(`取込失敗: ${e.message || e}`);
    }
    function fail(m){$('importStatus').textContent='取込失敗'; $('importResult').textContent=m;}
  }
  $('importButton').addEventListener('click',runImport);
})();
