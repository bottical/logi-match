(function(){
  const $=id=>document.getElementById(id);
  if (!$('importButton')) return; $('importButton').disabled=true; (async()=>{try{await window.initializeAppContext('master-import');window.renderSidebar?.();$('importButton').disabled=false;}catch(e){console.error('[master-import] init failed',e);$('importStatus').textContent='初期化に失敗しました。';}})();
  const db=()=>window.db;
  const requiredBase=['work_id','product_id','product_name','target_qty','recipient_name'];
  const nowIso=()=>new Date().toISOString();
  const dateKey=()=>new Date().toISOString().slice(0,10);
  const safe=s=>String(s||'').replace(/[^\w-]/g,'_');
  const BATCH_LIMIT=400;

  function mapHeaders(headers){ const map={}; Object.entries(window.csvUtils.HEADER_ALIASES).forEach(([k,aliases])=>{ const i=headers.findIndex(h=>aliases.includes((h||'').trim())); if(i>=0) map[k]=i;}); return map; }
  function rowObj(row,map){ const o={}; Object.entries(map).forEach(([k,i])=>o[k]=(row[i]||'').trim()); return o; }
  function renderMessages(id, rows){ const ul=$(id); ul.replaceChildren(); rows.forEach(r=>{const li=document.createElement('li'); li.textContent=r; ul.appendChild(li);}); }

  async function runImport(){
    if (!db()) return alert('Firebase未接続'); if(!window.appContext?.tenantId) return alert('テナント情報の取得が完了していません。再読み込みしてください。');
    const file=$('csvFile').files[0]; if(!file) return;
    $('importStatus').textContent='取込中...'; $('importResult').textContent=''; renderMessages('importErrors',[]); renderMessages('importWarnings',[]);
    const warnings=[]; const errors=[];
    try {
      const {text,encoding,warnings:dw}=window.csvUtils.decodeCsvArrayBuffer(await file.arrayBuffer()); warnings.push(...dw);
      const rows=window.csvUtils.parseCsv(text); if(rows.length<2) return fail('CSVとして読めない、またはデータがありません');
      const map=mapHeaders(rows[0]); const miss=requiredBase.filter(k=>map[k]===undefined); const hasBarcodeHeader = map.main_barcode !== undefined || map.alt_code !== undefined; if(miss.length || !hasBarcodeHeader) return fail('必須ヘッダ不足: '+[...miss, ...(!hasBarcodeHeader ? ['main_barcode または alt_code'] : [])].join(','));
      const valid=[];
      rows.slice(1).forEach((r,i)=>{ const n=i+2; const o=rowObj(r,map);
        const ng=(m)=>errors.push({row:n,reason:m,summary:`${o.work_id||''}/${o.product_id||''}/${o.product_name||''}`});
        if(!o.work_id) return ng('作業IDが空'); if(!o.product_id) return ng('商品IDが空'); if(!o.product_name) return ng('商品名が空');
        if(!o.main_barcode && !o.alt_code) return ng('メインバーコード・代替コードが空');
        const q=Number(o.target_qty); if(!o.target_qty || !Number.isFinite(q) || q<=0) return ng('指示数が不正');
        if((o.excluded_flag||'').toUpperCase()==='ON' || o.excluded_flag==='1') return ng('対象外フラグON');
        o.target_qty=q; o.scan_code=o.main_barcode||o.alt_code; o.row_number=n; valid.push(o);
      });
      if(!valid.length) return fail('正常行が1件もありません');
      $('importStatus').textContent='既存作業ID確認中...';
      const batchId=`batch_${Date.now()}`; const grouped={}; valid.forEach(v=>(grouped[v.work_id]??=[]).push(v));
      let batch=db().batch(), writes=0, successWorks=0, successDetails=0;
      const commitBatchIfNeeded = async (force=false) => { if (writes>=BATCH_LIMIT || (force && writes>0)) { await batch.commit(); batch=db().batch(); writes=0; } };
      for (const [workId,items] of Object.entries(grouped)) {
        const ref=db().collection('tenants').doc(window.appContext.tenantId).collection('inspectionWorks').doc(workId); const snap=await ref.get();
        if (snap.exists && snap.data()?.deleted_flag!==true && snap.data()?.work?.deleted_flag!==true) { warnings.push(`作業ID ${workId} は既に存在するため取り込みませんでした。再取込する場合は管理者が既存作業を削除してください。`); continue; }
        const dmap=new Map();
        items.forEach(it=>{ const key=it.scan_code; if(!dmap.has(key)) dmap.set(key,{detail_id:`${safe(workId)}_${String(dmap.size+1).padStart(3,'0')}`,work_id:workId,scan_code:key,main_barcode:it.main_barcode||'',alt_code:it.alt_code||'',product_id:it.product_id,product_name:it.product_name,target_qty:0,actual_qty:0,completed_flag:false,display_order_base:dmap.size+1,source_rows:[],created_at:nowIso(),updated_at:nowIso()}); const d=dmap.get(key); d.target_qty+=it.target_qty; d.source_rows.push(it.row_number); if(d.product_id!==it.product_id||d.product_name!==it.product_name) warnings.push(`作業ID ${workId} / コード ${key} で商品情報不一致`); });
        const details=[...dmap.values()]; const importDate=nowIso(); const importDateKey=dateKey();
        batch.set(ref,{work_id:workId,status:'unstarted',import_date:importDate,import_date_key:importDateKey,deleted_flag:false,work:{work_id:workId,batch_id:batchId,recipient_name:items[0].recipient_name||'',import_date:importDate,import_date_key:importDateKey,shipment_date:items[0].shipment_date||null,status:'unstarted',current_worker_id:null,current_started_at:null,completed_flag:false,started_at:null,completed_at:null,suspended_at:null,reset_count:0,deleted_flag:false,created_at:importDate,updated_at:importDate},details,recentScan:null,importMeta:{batch_id:batchId,source_file_name:file.name,encoding},updated_at:window.firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
        writes++; await commitBatchIfNeeded(); successWorks++; successDetails+=details.length;
      }
      $('importStatus').textContent='Firestore保存中...'; await commitBatchIfNeeded(true);
      const totalWorks=Object.keys(grouped).length; const batchStatus = successWorks===0 ? 'failed' : ((errors.length||warnings.length||successWorks<totalWorks)?'partial_success':'success');
      await db().collection('tenants').doc(window.appContext.tenantId).collection('importBatches').doc(batchId).set({batch_id:batchId,imported_at:window.firebase.firestore.FieldValue.serverTimestamp(),imported_by:window.auth?.currentUser?.email||'unknown-user',source_file_name:file.name,encoding,status:batchStatus,success_work_count:successWorks,success_detail_count:successDetails,source_row_count:rows.length-1,error_count:errors.length,warning_count:warnings.length,errors,warnings});
      $('importStatus').textContent=successWorks===0?'取込失敗':'取込完了'; $('importResult').textContent=`バッチ:${batchId} 作業:${successWorks} 明細:${successDetails} エラー:${errors.length} 警告:${warnings.length}`;
      renderMessages('importErrors', errors.map(e=>`行${e.row}: ${e.reason} (${e.summary})`)); renderMessages('importWarnings', warnings);
    } catch (e) {
      console.error('[import] failed', e); fail(`取込失敗: ${e.message || e}`);
    }
    function fail(m){$('importStatus').textContent='取込失敗'; $('importResult').textContent=m;}
  }
  $('importButton').addEventListener('click',runImport);
})();
