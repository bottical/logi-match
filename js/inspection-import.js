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
  const FIELD_LABELS={work_id:'ピッキングNo.',main_barcode:'JAN',alt_code:'代替コード',slip_no:'伝票番号',target_qty:'数量',product_name:'商品名',recipient_name:'お届け先名',shipment_date:'出荷日',shipper_name:'荷主名',location:'ロケーション',excluded_flag:'対象外フラグ',product_id:'商品ID'};
  const reasonMessages={NORMALIZED_CHARACTER:'使用できない可能性のある文字を置換して取り込みました。',INVALID_CHARACTER:'使用できない文字が含まれています。',MISSING_REQUIRED_FIELD:'必須項目が空欄です。',INVALID_QUANTITY:'数量が正の整数または0ではありません。',MISSING_BARCODE_FIELD:'JANまたは代替コードのどちらか一方は必須です。',COLUMN_OUT_OF_RANGE:'CSVマッピング設定に誤りがあります。',ROW_PARSE_ERROR:'CSV行のパースに失敗しました。',RECOMMENDED_FIELD_EMPTY:'推奨項目が空欄です。取込は継続しました。',PICKING_SKIPPED:'ピッキングNo.単位でスキップされました。',ENCODING_REPLACEMENT_CHAR:'読み込み後のCSVに置換文字が含まれています。',ZERO_QUANTITY_SKIPPED:'数量0のため取込対象外としてスキップしました。',EXCLUDED_FLAG_ON:'対象外フラグONの行は取込できません。',DUPLICATE_SCAN_KEY_WARNING:'同一検品キーを持つ明細があります。検品時は取込順に自動引当します。'};
  function formatReplacements(replacements){
    return replacements.map(({from,to})=>`「${from}」→「${to}」`).join('、');
  }
  function rowObj(row,map,rowNumber,warnings){
    const o={};
    Object.entries(map).forEach(([k,i])=>{
      const rawValue=String(row[i]??'');
      const normalizedValue=window.csvUtils.normalizeCsvValueByField(k,rawValue);
      o[k]=normalizedValue;
      const replacements=window.csvUtils.findUnsafeCharReplacements(rawValue,normalizedValue);
      if(replacements.length){
        warnings.push({severity:'warning',rowNumber,pickingNo:k==='work_id'?normalizedValue:'',columnName:FIELD_LABELS[k]||k,rawValue,normalizedValue,reasonCode:'NORMALIZED_CHARACTER',message:`使用できない可能性のある文字を置換して取り込みました。置換内容：${formatReplacements(replacements)}`});
      }
    });
    return o;
  }
  function makeIssue(severity,reasonCode,rowNumber,pickingNo,columnName,rawValue,normalizedValue,message){ return {severity, rowNumber, pickingNo:pickingNo||'', columnName, rawValue:rawValue??'', normalizedValue:normalizedValue??'', reasonCode, message:message||reasonMessages[reasonCode]||''}; }
  function formatIssue(issue){ const row=issue.rowNumber?`${issue.rowNumber}行目`:'取込前'; const col=issue.columnName?` / ${issue.columnName}`:''; const pick=issue.pickingNo?` / ピッキングNo.${issue.pickingNo}`:''; const val=issue.rawValue!==''&&issue.reasonCode!=='NORMALIZED_CHARACTER'?` 値：${issue.rawValue}`:''; if(issue.reasonCode==='NORMALIZED_CHARACTER') return `${row}${col}${pick}：${issue.message} ${issue.rawValue} → ${issue.normalizedValue}`; return `${row}${col}${pick}：${issue.message}${val}`; }
  function validateMappingRange(map,rows,mapping){
    const maxCols=rows.reduce((m,r)=>Math.max(m,r.length),0);
    const issues=[];
    Object.entries(map).forEach(([k,i])=>{ if(i>=maxCols){ issues.push(makeIssue('error','COLUMN_OUT_OF_RANGE',null,'',FIELD_LABELS[k]||k,mapping?.columns?.[Object.entries({pickingNo:'work_id',jan:'main_barcode',alternativeCode:'alt_code',productName:'product_name',quantity:'target_qty',destinationName:'recipient_name',slipNo:'slip_no',shipDate:'shipment_date',shipperName:'shipper_name',location:'location'}).find(([,v])=>v===k)?.[0]]||String(i+1),'',`CSVマッピング設定に誤りがあります。${FIELD_LABELS[k]||k}に指定された列がCSVの列数を超えています。CSV列数：${maxCols}列`)); } });
    return issues;
  }

  async function loadCsvMapping(clientId){
    if(!window.firestorePaths?.csvMappingCurrent) return null;
    const snap=await window.firestorePaths.csvMappingCurrent(clientId).get();
    if(!snap.exists) return null;
    return snap.data()||null;
  }

  function convertMappingKeysToLegacyMap(mapping){
    const columns=mapping?.columns||{};
    const keyMap={pickingNo:'work_id',jan:'main_barcode',alternativeCode:'alt_code',productName:'product_name',quantity:'target_qty',destinationName:'recipient_name',slipNo:'slip_no',shipDate:'shipment_date',shipperName:'shipper_name',location:'location'};
    const map={};
    Object.entries(keyMap).forEach(([newKey,legacyKey])=>{const index=columnLetterToIndex(columns[newKey]); if(index!==null&&index!==undefined) map[legacyKey]=index;});
    return map;
  }

  function renderMessages(id, rows){ const ul=$(id); ul.replaceChildren(); rows.forEach(r=>{const li=document.createElement('li'); li.textContent=r; ul.appendChild(li);}); }

  async function resolveImportContext(){
    const uid = window.auth?.currentUser?.uid || window.appContext?.uid || null;
    const email = window.auth?.currentUser?.email || null;
    const clientId = window.appContext?.clientId || window.appContext?.tenantId || null;
    const role = window.appContext?.role || null;
    const membershipActive = window.appContext?.membershipActive;
    return { uid, email, clientId, role, membershipActive };
  }

  function isPermissionDeniedError(error){
    return Boolean(error && (error.code === 'permission-denied' || String(error.message||'').includes('Missing or insufficient permissions')));
  }

  async function runImport(){
    if (!db()) return alert('システム接続を確認できません。時間をおいて再読み込みしてください。'); if(!window.appContext?.tenantId) return alert('テナント情報の取得が完了していません。再読み込みしてください。');
    const file=$('csvFile').files[0]; if(!file) return;
    $('importStatus').textContent='取込中...'; $('importResult').textContent=''; renderMessages('importErrors',[]); renderMessages('importWarnings',[]);
    const warnings=[]; const errors=[];
    const importPlan = { newWorks: [], overwriteWorks: [], skippedWorks: [], warnings, errors, blockedOperations: [] };
    try {
      const {text,encoding,warnings:dw}=window.csvUtils.decodeCsvArrayBuffer(await file.arrayBuffer()); warnings.push(...dw);
      const rows=window.csvUtils.parseCsv(text); if(rows.length<1) return fail('CSVとして読めない、またはデータがありません');
      // 現行 appContext では tenantId 名で保持しているが、設計仕様上は clientId として扱う。
      const context = await resolveImportContext();
      const clientId=context.clientId;
      if(!context.uid || !clientId || context.membershipActive === false) return fail('ログインユーザーの所属情報を確認できません。管理者に確認してください。');
      if(context.role !== 'admin') return fail('CSV取込権限がありません。管理者アカウントでログインしてください。');
      const mapping=await loadCsvMapping(clientId);
      const useMapping=Boolean(mapping?.columns);
      const inspectSlipNo=Boolean(mapping?.options?.inspectSlipNo);
      const map=useMapping?convertMappingKeysToLegacyMap(mapping):mapHeaders(rows[0]);
      const dataRows=useMapping?(mapping.hasHeader?rows.slice(1):rows):rows.slice(1);
      const miss=requiredBase.filter(k=>map[k]===undefined); const hasBarcodeHeader = map.main_barcode !== undefined || map.alt_code !== undefined; if(inspectSlipNo&&map.slip_no===undefined) miss.push('slip_no'); if(!mapping || miss.length || !hasBarcodeHeader) return fail('CSVマッピング設定に不足があります。マッピング設定を確認してください。');
      const mappingIssues=validateMappingRange(map,rows,mapping); if(mappingIssues.length){ errors.push(...mappingIssues); $('importStatus').textContent='取込失敗'; renderMessages('importErrors', errors.map(formatIssue)); return; }
      const valid=[];
      const fatalPickingNos = new Set();
      dataRows.forEach((r,i)=>{ const n=(useMapping&&mapping.hasHeader===false)?i+1:i+2; const rowWarnings=[]; const o=rowObj(r,map,n,rowWarnings); rowWarnings.forEach(w=>{ w.pickingNo=o.work_id||w.pickingNo; warnings.push(w); });
        const ng=(reasonCode,columnName,rawValue,message)=>{ errors.push(makeIssue('error',reasonCode,n,o.work_id,columnName,rawValue,rawValue,message)); if(o.work_id) fatalPickingNos.add(o.work_id); };
        if(!o.work_id) return ng('MISSING_REQUIRED_FIELD','ピッキングNo.',o.work_id,'ピッキングNo.は必須です。');
        if(!o.main_barcode && !o.alt_code) return ng('MISSING_BARCODE_FIELD','JAN・代替コード','',reasonMessages.MISSING_BARCODE_FIELD);
        const q=Number(o.target_qty); if(!o.target_qty || !Number.isFinite(q) || q<0 || !Number.isInteger(q)) return ng('INVALID_QUANTITY','数量',o.target_qty,reasonMessages.INVALID_QUANTITY);
        if(q===0){ warnings.push(makeIssue('warning','ZERO_QUANTITY_SKIPPED',n,o.work_id,'数量',o.target_qty,o.target_qty,'数量0のため取込対象外としてスキップしました。')); return; }
        if(!o.product_name) warnings.push(makeIssue('warning','RECOMMENDED_FIELD_EMPTY',n,o.work_id,'商品名',o.product_name,o.product_name,'商品名が空欄です。取込は継続しました。'));
        if((o.excluded_flag||'').toUpperCase()==='ON' || o.excluded_flag==='1') return ng('EXCLUDED_FLAG_ON','対象外フラグ',o.excluded_flag,'対象外フラグONの行は取込できません。');
        if(inspectSlipNo && !o.slip_no) return ng('MISSING_REQUIRED_FIELD','伝票番号',o.slip_no,'伝票番号は必須です。');
        o.product_id=o.product_id||`AUTO-${o.work_id}-${n}`; o.product_name=o.product_name||''; o.recipient_name=o.recipient_name||''; o.target_qty=q; o.scan_code=o.main_barcode||o.alt_code; o.row_number=n; valid.push(o);
      });
      if(fatalPickingNos.size){
        [...fatalPickingNos].forEach(pickingNo=>{
          const total=errors.filter(e=>e.pickingNo===pickingNo).length;
          errors.push(makeIssue('error','PICKING_SKIPPED',null,pickingNo,'ピッキングNo.','', '', `CSV内に取込できない行が${total||1}件あります。対象のピッキングNo.はスキップされました。`));
        });
      }
      if(!valid.length){ renderMessages('importErrors', errors.map(formatIssue)); renderMessages('importWarnings', warnings.map(formatIssue)); return fail('正常行が1件もありません'); }
      $('importStatus').textContent='既存作業ID確認中...';
      const batchId=`batch_${Date.now()}`; const grouped={}; valid.forEach(v=>(grouped[v.work_id]??=[]).push(v));
      let batch=db().batch(), writes=0, successWorks=0, successDetails=0;
      const commitBatchIfNeeded = async (force=false) => { if (writes>=BATCH_LIMIT || (force && writes>0)) { await batch.commit(); batch=db().batch(); writes=0; } };
      for (const [rawPickingNo,items] of Object.entries(grouped)) {
        if(fatalPickingNos.has(rawPickingNo)) continue;
        const workId=sanitizeWorkId(rawPickingNo);
        const ref=window.firestorePaths.inspectionWork(clientId, workId);
        const snap=await ref.get();
        const currentStatus=snap.exists?((snap.data()||{}).status||'unstarted'):null;
        if (snap.exists && ['current','suspended','completed','deleted'].includes(currentStatus)) {
          const statusMsg = currentStatus==='completed' ? '検品完了済みのため上書きできません' : currentStatus==='current' ? '作業中のため上書きできません' : currentStatus==='suspended' ? '中断中のため上書きできません' : '削除済みのため上書きできません';
          const msg = `${rawPickingNo}：${statusMsg}`;
          importPlan.skippedWorks.push({ pickingNo: rawPickingNo, reasonCode: `status_${currentStatus}`, message: msg });
          warnings.push(makeIssue('warning', `status_${currentStatus}`, null, rawPickingNo, 'ピッキングNo.', '', '', msg));
          continue;
        }

        if (snap.exists && currentStatus==='unstarted') {
          const existingItemsSnap = await window.firestorePaths.inspectionItems(clientId, workId).get();
          const orderValue=(row,index)=>Number(row?.sortOrder ?? row?.sort_order ?? row?.lineNo ?? row?.line_no ?? row?.display_order_base ?? row?.displayOrderBase ?? row?.source_rows?.[0] ?? row?.rowNumbers?.[0] ?? index);
          const normalizeDetailSignature=(row,index)=>({jan:String(row?.jan ?? row?.main_barcode ?? '').trim(),alternativeCode:String(row?.alternativeCode ?? row?.alt_code ?? '').trim(),slipNo:String(row?.slipNo ?? row?.slip_no ?? '').trim(),productName:String(row?.productName ?? row?.product_name ?? '').trim(),targetQty:Number(row?.targetQty ?? row?.target_qty ?? 0),sortOrder:orderValue(row,index)});
          const existingSignature=existingItemsSnap.docs.map((doc,index)=>normalizeDetailSignature(doc.data()||{},index)).sort((a,b)=>a.sortOrder-b.sortOrder);
          const incomingSignature=items.map((it,index)=>normalizeDetailSignature({jan:it.main_barcode,alternativeCode:it.alt_code,slipNo:it.slip_no,productName:it.product_name,targetQty:it.target_qty,sortOrder:index+1},index));
          const requiresDelete = JSON.stringify(existingSignature) !== JSON.stringify(incomingSignature);
          if(requiresDelete){
            const blockedMessage = `${rawPickingNo}：既存明細と今回CSVの明細構成（順序・検品キー・商品名・数量）が異なるため、上書きできませんでした`;
            importPlan.blockedOperations.push({ pickingNo: rawPickingNo, reasonCode: 'requires_delete', message: blockedMessage });
            warnings.push(makeIssue('warning', 'requires_delete', null, rawPickingNo, 'ピッキングNo.', '', '', blockedMessage));
            warnings.push(makeIssue('warning', 'requires_delete', null, rawPickingNo, 'ピッキングNo.', '', '', '現在の安全設定では、取込済み明細の削除を伴う差し替えは行いません。'));
            continue;
          }
          importPlan.overwriteWorks.push(rawPickingNo);
        }
        if (!snap.exists) importPlan.newWorks.push(rawPickingNo);

        const duplicateScanKeyMap = new Map();
        items.forEach((it) => {
          [...new Set([String(it.main_barcode || '').trim(), String(it.alt_code || '').trim()].filter(Boolean))].forEach((key) => {
            if (!duplicateScanKeyMap.has(key)) duplicateScanKeyMap.set(key, []);
            duplicateScanKeyMap.get(key).push(it);
          });
        });
        duplicateScanKeyMap.forEach((rows, key) => {
          if (rows.length <= 1) return;
          const targetLines = rows.map((it) => `- ${it.row_number}行目: ${it.product_name || ''} / 数量${it.target_qty}`).join('\n');
          warnings.push(makeIssue('warning','DUPLICATE_SCAN_KEY_WARNING',null,rawPickingNo,'検品キー',key,key,`同一検品キーを持つ明細があります。検品時は取込順に自動引当します。\n※この処理は、同一検品キーの明細が同一物理商品であることを前提とします。\nピッキングNo: ${rawPickingNo}\n検品キー: ${key}\n対象明細:\n${targetLines}`));
        });
        const details=items.map((it,index)=>({itemId:`${safe(workId)}_${String(index+1).padStart(3,'0')}`,jan:it.main_barcode||'',alternativeCode:it.alt_code||'',scanKeys:[{type:'jan',value:it.main_barcode||''},{type:'alternative',value:it.alt_code||''}].filter((x,idx,arr)=>x.value&&arr.findIndex(y=>y.value===x.value)===idx),productName:it.product_name||'',targetQty:it.target_qty,actualQty:0,inspectionRequired:true,itemStatus:'unstarted',rowNumbers:[it.row_number],sourceRows:[it.row_number],lineNo:it.row_number,sortOrder:index+1,warningMessages:[]}));
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
        const shipDate=items[0].shipment_date||null;
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
          display_order_base: item.sortOrder || index + 1,
          lineNo: item.lineNo || item.rowNumbers?.[0] || index + 1,
          sortOrder: item.sortOrder || index + 1,
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
      $('importStatus').textContent='取込内容を保存中...'; await commitBatchIfNeeded(true);
      const totalWorks=Object.keys(grouped).length; const errorCount=errors.filter(e=>e.reasonCode!=='PICKING_SKIPPED').length; const batchStatus = successWorks===0 ? 'failed' : ((errorCount||warnings.length||successWorks<totalWorks)?'partial_success':'success');
      await window.firestorePaths.importBatches(clientId).doc(batchId).set({batchId,batch_id:batchId,importedAt:window.firebase.firestore.FieldValue.serverTimestamp(),imported_at:window.firebase.firestore.FieldValue.serverTimestamp(),importedBy:window.auth?.currentUser?.email||'unknown-user',imported_by:window.auth?.currentUser?.email||'unknown-user',sourceFileName:file.name,source_file_name:file.name,encoding,status:batchStatus,successWorkCount:successWorks,success_work_count:successWorks,successDetailCount:successDetails,success_detail_count:successDetails,sourceRowCount:dataRows.length,source_row_count:dataRows.length,errorCount,error_count:errorCount,warningCount:warnings.length,warning_count:warnings.length,errors,warnings});
      const opRef=window.firestorePaths.operationLogs(clientId).doc();
      await opRef.set({logId:opRef.id,clientId,operationType:'import',targetType:'importBatch',targetId:batchId,workerId:null,workerNameSnapshot:null,userId:window.appContext.uid,deviceId:localStorage.getItem('deviceId')||null,detail:{sourceFileName:file.name,sourceRowCount:dataRows.length,successWorkCount:successWorks,successDetailCount:successDetails,errorCount,warningCount:warnings.length},operatedAt:window.firebase.firestore.FieldValue.serverTimestamp()});
      const skippedCount = importPlan.skippedWorks.length + importPlan.blockedOperations.length + fatalPickingNos.size;
      if (successWorks === 0) {
        $('importStatus').textContent = '取込失敗';
      } else if (errorCount || skippedCount > 0) {
        $('importStatus').textContent = '一部取込完了';
      } else if (warnings.length) {
        $('importStatus').textContent = '取込完了（警告あり）';
      } else {
        $('importStatus').textContent = '取込完了';
      }
      $('importResult').textContent=`バッチ:${batchId} 作業:${successWorks} 明細:${successDetails} スキップ:${skippedCount} エラー:${errorCount} 警告:${warnings.length}`;
      renderMessages('importErrors', errors.map(formatIssue)); renderMessages('importWarnings', warnings.map(formatIssue));
    } catch (e) {
      if (isPermissionDeniedError(e)) {
        const ctx = await resolveImportContext();
        const writeTargets = ['inspectionWork','inspectionItems','importBatches','operationLogs'];
        console.error('[master-import] permission denied detail', { uid: ctx.uid, email: ctx.email, clientId: ctx.clientId, role: ctx.role, writeTargets, error: e });
        fail('取込処理を実行できませんでした。取込対象の状態または操作権限を確認してください。');
        return;
      }
      console.error('[import] failed', e); fail('取込処理中にエラーが発生しました。時間をおいて再試行してください。');
    }
    function fail(m){$('importStatus').textContent='取込失敗'; $('importResult').textContent=m;}
  }
  $('importButton').addEventListener('click',runImport);
})();
