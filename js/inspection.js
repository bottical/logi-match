(()=>{
const state=window.inspectionState,$=id=>document.getElementById(id),statusMap={unstarted:'未着手',current:'作業中',suspended:'中断',completed:'完了'},syncMap={idle:['待機中','idle'],saving:['同期中','saving'],saved:['同期済み','saved'],failed:['同期エラー','failed']};
const DETAIL_TABLE_COLUMNS=[{key:'status',label:'状態',type:'state'},{key:'main_barcode',label:'JAN',type:'jan'},{key:'product_name',label:'商品名',fallbackKeys:['productName','itemName','商品名']},{key:'target_qty',label:'予定数量',type:'target'},{key:'actual_qty',label:'実績数量',type:'actual'},{key:'remaining',label:'残数',type:'remaining'}];
const blank=()=>({work:{work_id:null,recipient_name:'',status:'unstarted',current_worker_id:null,completed_flag:false},details:[],recentScan:null,lastScannedCode:'',syncStatus:'idle',lock:{locked:false,reason:null,worker_id:null,started_at:null},qtyMode:{enabled:true,qty:1},startedAt:null,lastCompletedSummary:''});
const normalize=v=>String(v||'').trim();
const getScanKeys=d=>{
 const keys=[];
 const push=(type,value)=>{const v=normalize(value);if(v)keys.push({type,value:v});};
 if(Array.isArray(d.scanKeys)) d.scanKeys.forEach(k=>push(k?.type||'unknown',k?.value));
 push('jan',d.main_barcode||d.scan_code||d.jan);
 push('alternative',d.alt_code||d.alternativeCode);
 return keys;
};
const getTargetQty=d=>Number(d?.target_qty ?? d?.targetQty ?? 0);
const getActualQty=d=>Number(d?.actual_qty ?? d?.actualQty ?? 0);
const isExcludedDetail=d=>d?.inspectionRequired===false||d?.inspection_required===false||getTargetQty(d)===0;
const user=()=>window.appContext?.uid||window.auth?.currentUser?.uid||'unknown-user';
const selectedWorker=()=>window.workerContext?.selectedWorker;
const playSound=(k)=>{try{if(window.AudioManager?.play)window.AudioManager.play(k);}catch(_){}};
const setJudge=(t,m,s='')=>{$('judgePanel').className=`inspection-judge inspection-judge--${t}`;$('mainMsgTxt').textContent=m;$('judgeSubText').textContent=s;};
const focusPickingNoInput=()=>requestAnimationFrame(()=>{$('pickingNoInput').focus();$('pickingNoInput').select();});
const focusJanInput=()=>requestAnimationFrame(()=>{if(!$('scanCodeInput').disabled){$('scanCodeInput').focus();$('scanCodeInput').select();}});
const hasSelectedWorker=()=>Boolean(selectedWorker()?.workerId);
const populateWorkerSelect=(selectEl,workers,selectedWorkerId)=>{ if(!selectEl) return; selectEl.innerHTML='<option value="">作業者を選択してください</option>'; workers.forEach(worker=>{ const option=document.createElement('option'); option.value=worker.workerId; option.textContent=worker.workerName; if(String(worker.workerId)===String(selectedWorkerId||'')) option.selected=true; selectEl.appendChild(option); });};
const rank=d=>state.recentScan?.detail?.detail_id===d.detail_id?-1:(!d.completed_flag&&d.actual_qty>0?0:d.actual_qty===0?1:2);
const pickValue=(obj,keys)=>{for(const k of keys||[]){if(obj&&obj[k]!=null&&obj[k]!=='')return obj[k];}return '';};
const display=value=>value==null||value===''?'-':value;
const secToClock=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
function buildScanIndex(items){const index=new Map();for(const item of items||[]){if(isExcludedDetail(item)) continue;for(const key of getScanKeys(item)){if(!key.value) continue;if(index.has(key.value)&&index.get(key.value)!==item) throw new Error('DUPLICATE_SCAN_KEY:'+key.value);index.set(key.value,item);}}return index;}

function render(){
 const activeDetails=state.details.filter(d=>!isExcludedDetail(d));const excludedCount=state.details.length-activeDetails.length;const skuDone=activeDetails.filter(d=>d.completed_flag).length,qa=activeDetails.reduce((n,d)=>n+getActualQty(d),0),qt=activeDetails.reduce((n,d)=>n+getTargetQty(d),0);
 $('recipientName').textContent=display(state.work.recipient_name);$('workStatus').textContent=statusMap[state.work.status]||state.work.status;
 $('skuProgress').textContent=`${skuDone} / ${activeDetails.length}`;$('qtyProgress').textContent=`${qa} / ${qt}`;$('judgeProgressText').textContent=state.details.length?`数量 ${qa} / ${qt}`:'';
 $('shipperName').textContent=display(pickValue(state.work,['shipperName','ownerName','clientName','荷主様名']));
 $('customerName').textContent=display(pickValue(state.work,['recipientName','recipient_name','customerName','deliveryName','得意先名','お届け先名']));
 $('sentCode').textContent=display(state.lastScannedCode||state.recentScan?.scanCode);
 $('workerDisplayName').textContent=selectedWorker()?.workerName||'未選択';
 $('workIdDisplay').textContent=display(state.work.work_id);
 const elapsed=state.startedAt?Math.max(0,Math.floor((Date.now()-state.startedAt)/1000)):0;$('elapsedTime').textContent=secToClock(elapsed);
 const [l,k]=syncMap[state.syncStatus]||syncMap.idle;$('syncStatus').textContent=l;$('syncStatus').className=`inspection-status-badge inspection-status-badge--${k}`;
 const isLoaded=Boolean(state.work.work_id)&&state.details.length>0&&state.work.status!=='completed';
 $('pickingNoInput').hidden=isLoaded;$('loadPickingButton').hidden=isLoaded;$('workIdDisplay').hidden=!isLoaded;
 $('scanQtyInput').disabled=!isLoaded||!hasSelectedWorker();
 const topStatusText=$('topStatusText'); if(topStatusText){ topStatusText.textContent=state.work.status==='completed'?'完了':(isLoaded?'JANスキャン待ち':'ピッキングNo.待ち'); }
 const sorted=[...state.details].sort((a,b)=>rank(a)-rank(b)||String(a.product_name||'').localeCompare(String(b.product_name||''),'ja'));
 const head=$('detailTableHead');const body=$('detailTableBody');head.replaceChildren();body.replaceChildren();
 DETAIL_TABLE_COLUMNS.forEach(c=>{const th=document.createElement('th');th.textContent=c.label;head.appendChild(th);});
 sorted.forEach(d=>{const tr=document.createElement('tr');const excluded=isExcludedDetail(d);let cls='detail-row--pending';if(excluded){cls='detail-row--excluded';}else if(state.recentScan?.detail?.detail_id===d.detail_id){cls='detail-row--recent';}else if(d.error_flag){cls='detail-row--error';}else if(d.completed_flag){cls='detail-row--done';}else if(getActualQty(d)>0){cls='detail-row--partial';}tr.className=cls;
 DETAIL_TABLE_COLUMNS.forEach(c=>{const td=document.createElement('td');if(c.type==='state')td.textContent=excluded?'検品対象外':(d.completed_flag?'完了':(getActualQty(d)>0?'途中':'未着手'));else if(c.type==='target')td.textContent=String(getTargetQty(d));else if(c.type==='actual')td.textContent=String(getActualQty(d));else if(c.type==='remaining')td.textContent=excluded?'-':String(getTargetQty(d)-getActualQty(d));else if(c.type==='jan'){const jan=String(pickValue(d,['main_barcode','scan_code','barcode','JAN','jan'])||'').trim();td.textContent=jan||'-';td.classList.add('cell-jan');}else td.textContent=display(pickValue(d,[c.key,...(c.fallbackKeys||[])]));tr.appendChild(td);});body.appendChild(tr);});
 const summaryPanel=$('lastCompletedSummaryPanel');const summaryText=$('lastCompletedSummaryText');if(summaryPanel&&summaryText){summaryPanel.hidden=!state.lastCompletedSummary;summaryText.textContent=state.lastCompletedSummary||'';}
}
async function safeAppendScanLog(workId,log){try{await window.appendScanLog(workId,log);}catch(e){console.error('[scanLog] failed',e);}}
async function persistAsync(reason,payload={}){state.syncStatus='saving';render();try{await window.saveInspectionState(state,{reason,payload});state.syncStatus='saved';render();return true;}catch(e){state.syncStatus='failed';state.lock={locked:true,reason:'sync-error',worker_id:null,started_at:new Date().toISOString()};setJudge('locked','同期失敗により停止中','再読取せず管理者へ確認してください');render();playSound('warning');return false;}}
function resetToPickingNoInput(options={}){const summary=options.completedSummary||state.lastCompletedSummary;Object.assign(state,blank());state.lastCompletedSummary=summary;$('pickingNoInput').value='';$('scanCodeInput').value='';$('scanQtyInput').value='1';$('pickingNoInput').disabled=false;$('scanCodeInput').disabled=true;$('scanQtyInput').disabled=true;$('pauseButton').disabled=true;$('resetButton').disabled=true;setJudge(options.completed?'complete':'idle',options.message||(options.completed?'検品完了':'ピッキングNo.待ち'),options.subMessage||(options.completed?'次のピッキングNo.を入力してください':(selectedWorker()?'次のピッキングNo.を入力してください':'作業者を選択してください')));render();focusPickingNoInput();}
function confirmAction(message,onOk){const d=$('confirmDialog');const cleanup=()=>{ $('confirmOk').onclick=null;$('confirmCancel').onclick=null;d.close?.();};const focusBack=()=>{if(state.work.work_id&&!$('scanCodeInput').disabled)focusJanInput();else focusPickingNoInput();};$('confirmMessage').textContent=message;$('confirmOk').onclick=()=>{cleanup();onOk();};$('confirmCancel').onclick=()=>{cleanup();focusBack();};if(typeof d.showModal==='function')d.showModal();else if(window.confirm(message))$('confirmOk').onclick();else $('confirmCancel').onclick();}
async function loadPickingNo(v){const workId=String(v||'').trim();$('pickingNoInput').value=workId;if(!workId){resetToPickingNoInput();return;}if(!hasSelectedWorker()){setJudge('warning','作業者を選択してください','画面上部の「作業者変更」から作業者を選択してください');$('scanCodeInput').disabled=true;$('scanQtyInput').disabled=true;render();$('workerChangeButton')?.focus();return;}setJudge('idle','読込中','');$('scanCodeInput').disabled=true;render();let loaded;try{loaded=await window.loadInspectionState(workId);}catch(error){console.error('[inspection] loadInspectionState failed',error);setJudge('error','読込に失敗しました','検品データの取得に失敗しました。管理者に確認してください。');$('scanCodeInput').disabled=true;$('scanQtyInput').disabled=true;$('pauseButton').disabled=true;$('resetButton').disabled=true;render();playSound('warning');focusPickingNoInput();return;}if(!loaded){setJudge('error','エラー','該当するピッキングNo.がありません');playSound('warning');focusPickingNoInput();return;}Object.assign(state,loaded);state.work.work_id=state.work.work_id||state.work.workId||workId;state.work.pickingNo=state.work.pickingNo||state.work.picking_no||workId;state.currentWork=state.work;state.currentItems=loaded.details||[];state.pendingWrites=[];state.isSyncBlocked=false;try{state.scanIndex=buildScanIndex(state.currentItems);}catch(error){console.error('[inspection] buildScanIndex failed',error);setJudge('error','検品キーが重複しています','管理者にCSVデータを確認してください');$('scanCodeInput').disabled=true;$('scanQtyInput').disabled=true;$('pauseButton').disabled=true;$('resetButton').disabled=true;render();focusPickingNoInput();return;}sessionStorage.setItem('inspection.currentWorkSnapshot',JSON.stringify({workId:state.work.work_id,pickingNo:state.work.pickingNo||state.work.work_id,loadedAt:Date.now()}));state.startedAt=Date.now();if(state.work.status==='completed'||state.work.completed_flag===true||state.work.completedFlag===true){await safeAppendScanLog(workId,{workId,pickingNo:workId,scannedCode:workId,codeType:'unknown',result:'completed_work',errorMessage:'検品完了済み',inputQty:0,beforeQty:null,afterQty:null,targetQty:null,workerId:selectedWorker()?.workerId||null,workerNameSnapshot:selectedWorker()?.workerName||null,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web'});state.work.status='completed';$('scanCodeInput').disabled=true;$('pauseButton').disabled=true;$('resetButton').disabled=true;setJudge('locked','完了済み','このピッキングNo.はすでに完了しています');render();playSound('warning');focusPickingNoInput();return;}if(!state.details.length){setJudge('error','エラー','このピッキングNo.には検品対象がありません');render();focusPickingNoInput();return;}if(!selectedWorker()){setJudge('warning','作業者を選択してください','画面上部の「作業者変更」から作業者を選択してください');focusPickingNoInput();return;}const lock=await window.acquireWorkLock(workId,{workerId:selectedWorker().workerId,workerName:selectedWorker().workerName,loginUid:window.appContext.uid,loginEmail:window.appContext.email});if(!lock.ok){await safeAppendScanLog(workId,{workId,pickingNo:workId,scannedCode:workId,codeType:'unknown',result:'locked',errorMessage:'他作業者ロック中',inputQty:0,beforeQty:null,afterQty:null,targetQty:null,workerId:selectedWorker()?.workerId||null,workerNameSnapshot:selectedWorker()?.workerName||null,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web'});setJudge('locked','他の作業者が作業中です',`${lock.workerId||'-'} ${lock.startedAt||''}`);$('scanCodeInput').disabled=true;render();focusPickingNoInput();return;}state.work.status='current';state.work.current_worker_id=selectedWorker().workerId;state.work.current_worker_name=selectedWorker().workerName;state.work.current_login_uid=window.appContext.uid;state.work.current_login_email=window.appContext.email;state.lock={locked:false,reason:null,worker_id:null,started_at:null};$('scanCodeInput').disabled=false;$('pauseButton').disabled=false;$('resetButton').disabled=false;setJudge('working','スキャン待ち','JAN / 代替コードをスキャンしてください');render();focusJanInput();}
async function runScan(){ if(!selectedWorker()){setJudge('warning','作業者を選択してください','');playSound('warning');focusPickingNoInput();return;}if(!state.work.work_id||$('scanCodeInput').disabled){setJudge('warning','ピッキングNo.待ち','次のピッキングNo.をスキャンしてください');focusPickingNoInput();return;}const raw=$('scanCodeInput').value.trim();if(!raw)return;$('scanCodeInput').value='';const qty=Number($('scanQtyInput').value);
 if(!Number.isInteger(qty)||qty<=0){await safeAppendScanLog(state.work.work_id,{workId:state.work.work_id,pickingNo:state.work.work_id,scannedCode:raw,codeType:'unknown',result:'invalid',errorMessage:'数量不正',inputQty:qty,beforeQty:null,afterQty:null,targetQty:null,workerId:selectedWorker().workerId,workerNameSnapshot:selectedWorker().workerName,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web'});setJudge('error','数量エラー','読取数量を確認してください');playSound('ng');$('scanQtyInput').value='1';focusJanInput();return;}
 const detailFromIndex=state.scanIndex?.get(raw)||null;let matched=null;if(detailFromIndex&&!isExcludedDetail(detailFromIndex)){const key=getScanKeys(detailFromIndex).find(k=>k.value===raw);matched={detail:detailFromIndex,codeType:key?.type||'unknown'};}const detail=matched?.detail;if(!detail){await safeAppendScanLog(state.work.work_id,{workId:state.work.work_id,pickingNo:state.work.work_id,scannedCode:raw,codeType:'unknown',result:'not_found',errorMessage:'対象外コード',inputQty:qty,beforeQty:null,afterQty:null,targetQty:null,workerId:selectedWorker().workerId,workerNameSnapshot:selectedWorker().workerName,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web'});setJudge('error','対象外コードです',`読取コード：${raw}`);playSound('ng');$('scanQtyInput').value='1';focusJanInput();return;}
// NOTE: This is a UI pre-check from local state. Final quantity integrity is enforced in applyScanTransaction().
const beforeQty=getActualQty(detail), targetQty=getTargetQty(detail);if(beforeQty+qty>targetQty){await safeAppendScanLog(state.work.work_id,{workId:state.work.work_id,pickingNo:state.work.work_id,scannedCode:raw,codeType:matched?.codeType||'unknown',result:'over_qty',errorMessage:'必要数超過',inputQty:qty,beforeQty,afterQty:beforeQty,targetQty,workerId:selectedWorker().workerId,workerNameSnapshot:selectedWorker().workerName,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web'});setJudge('error','必要数を超えています','数量を確認してください');playSound('ng');$('scanQtyInput').value='1';focusJanInput();return;}
 const applied=await window.applyScanTransaction?.({workId:state.work.work_id,scannedCode:raw,inputQty:qty,workerId:selectedWorker().workerId,workerName:selectedWorker().workerName,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web'});if(!applied?.ok){const message=applied?.message||'';if(message==='over qty'||message==='over_qty'){setJudge('error','必要数を超えています','数量を確認してください');playSound('ng');$('scanQtyInput').value='1';render();focusJanInput();return;}if(message==='not found'||message==='not_found'){setJudge('error','対象外コードです',`読取コード：${raw}`);playSound('ng');$('scanQtyInput').value='1';render();focusJanInput();return;}state.syncStatus='failed';state.isSyncBlocked=true;$('scanCodeInput').disabled=true;setJudge('error','同期エラー',message||'再読込してください');playSound('ng');$('scanQtyInput').value='1';render();focusPickingNoInput();return;}
 const currentWorkId=state.work.work_id;Object.assign(state,applied.state);state.work.work_id=state.work.work_id||state.work.workId||applied.state?.work?.work_id||currentWorkId;state.work.pickingNo=state.work.pickingNo||state.work.picking_no||state.work.work_id||currentWorkId;state.syncStatus='saved';state.isSyncBlocked=false;state.currentWork=state.work;state.currentItems=state.details||[];try{state.scanIndex=buildScanIndex(state.currentItems);}catch(error){console.error('[inspection] rebuildScanIndex failed',error);state.syncStatus='failed';state.isSyncBlocked=true;$('scanCodeInput').disabled=true;setJudge('error','検品キーの再構築に失敗しました','再読込してください');render();focusPickingNoInput();return;}const updated=state.details.find(x=>x.detail_id===applied.detailId)||detail;state.lastScannedCode=raw;state.recentScan={scanCode:raw,detail:updated,at:Date.now()};const remain=getTargetQty(updated)-getActualQty(updated);
 setJudge('ok',`OK ${updated.product_name||''} +${qty}`,`数量 ${getActualQty(updated)} / ${getTargetQty(updated)}  残り ${remain}`);
 const allDone=state.details.filter(d=>!isExcludedDetail(d)).every(d=>d.completed_flag);if(allDone){const completedPickingNo=state.work.pickingNo||state.work.picking_no||state.work.work_id;state.lastCompletedSummary=`${completedPickingNo} を完了しました`;playSound('strong-complete');setJudge('complete','検品完了','次のピッキングNo.を入力してください');render();$('scanQtyInput').value='1';resetToPickingNoInput({completed:true,completedSummary:state.lastCompletedSummary});return;}
 playSound(updated.completed_flag?'complete':'ok');render();$('scanQtyInput').value='1';focusJanInput();}
async function init(){resetToPickingNoInput();$('headerUserName')?.remove();
 const workerSelect=$('workerSelect');let workers=[];
 const updateWorkerUi=(worker)=>{ $('workerDisplayName').textContent=worker?.workerName||'未選択'; $('scanCodeInput').disabled=true; $('scanQtyInput').disabled=true; if(worker){ setJudge('idle','ピッキングNo.待ち','ピッキングNo.を入力してください'); render(); focusPickingNoInput(); }else{ setJudge('warning','作業者を選択してください','画面上部の「作業者変更」から作業者を選択してください'); render(); } };
 const applyWorkerSelection=(workerId)=>{ const worker=window.selectWorker(window.appContext.clientId||window.appContext.tenantId,workerId); if(workerSelect) workerSelect.value=worker?.workerId||''; if(!worker){ updateWorkerUi(null); if(workerSelect&&!workerSelect.hidden){workerSelect.focus();}else{$('workerChangeButton')?.focus();} return null; } updateWorkerUi(worker); workerSelect.hidden=true; $('workerChangeButton').hidden=false; focusPickingNoInput(); return worker; };
 try{ workers=await window.loadWorkers(window.appContext.clientId||window.appContext.tenantId);}catch(error){ console.error('[inspection] failed to load workers', error); setJudge('error','作業者一覧の取得に失敗しました。','Firestoreの workers パス設定を確認してください。'); render(); return; }
 if(window.setWorkerList)window.setWorkerList(workers);
 if(!workers.length){ $('workerDisplayName').textContent='未登録'; workerSelect.hidden=true; $('workerChangeButton').hidden=true; $('scanCodeInput').disabled=true; $('scanQtyInput').disabled=true; setJudge('warning','有効な作業者が登録されていません。','管理者に確認してください。'); render(); return; }
 const restored=window.restoreSelectedWorker?.(window.appContext.clientId||window.appContext.tenantId); const selectedId=restored?.workerId||'';
 populateWorkerSelect(workerSelect,workers,selectedId);
 if(restored?.workerId){ applyWorkerSelection(restored.workerId); }else{ updateWorkerUi(null); workerSelect.hidden=true; $('workerChangeButton').hidden=false; }
 workerSelect?.addEventListener('change',()=>applyWorkerSelection(workerSelect.value));
 workerSelect?.addEventListener('blur',()=>{ if(!workerSelect.value||selectedWorker()?.workerId){ workerSelect.hidden=true; $('workerChangeButton').hidden=false; }});
 $('workerChangeButton').addEventListener('click',()=>{ workerSelect.hidden=false; $('workerChangeButton').hidden=true; workerSelect.value=selectedWorker()?.workerId||''; workerSelect.focus(); });
 const id=new URLSearchParams(location.search).get('work_id');
 if(id){$('pickingNoInput').value=id;await loadPickingNo(id);} }
$('loadPickingButton').addEventListener('click',()=>loadPickingNo($('pickingNoInput').value));$('pickingNoInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();loadPickingNo($('pickingNoInput').value);}});$('scanCodeInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runScan();}});$('scanSubmitButton').addEventListener('click',runScan);
$('pauseButton').addEventListener('click',()=>confirmAction('この作業を中断します。よろしいですか？',async()=>{if(!hasSelectedWorker()||state.work.status!=='current'){setJudge('warning','中断できません','作業中のみ中断できます');return;}try{await window.suspendInspectionWork({workId:state.work.work_id,workerId:selectedWorker().workerId,workerName:selectedWorker().workerName,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web',pickingNo:state.work.work_id,suspendedBy:window.auth?.currentUser?.uid||window.appContext.uid});resetToPickingNoInput({message:'中断しました',subMessage:'次のピッキングNo.を入力してください'});}catch(e){setJudge('error','中断に失敗しました','通信状態を確認してください');}}));
$('resetButton').addEventListener('click',()=>{if(state.work.status==='completed'||state.work.completed_flag===true||state.work.completedFlag===true){setJudge('warning','この画面から完了済み検品はリセットできません。','管理者が検品完了一覧からリセットしてください。');focusPickingNoInput();return;}confirmAction('このピッキングNo.の検品実績をリセットします。\n読み取り数量は0に戻ります。\n過去のスキャンログは削除されません。\n実行してよろしいですか？',async()=>{if(!hasSelectedWorker()||!['unstarted','current','suspended'].includes(state.work.status)){setJudge('warning','リセットできません','未着手・作業中・中断のみ実行できます');return;}try{await window.resetInspectionWork({workId:state.work.work_id,workerId:selectedWorker().workerId,workerName:selectedWorker().workerName,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web',pickingNo:state.work.work_id});resetToPickingNoInput({message:'リセットしました',subMessage:'次のピッキングNo.を入力してください'});}catch(e){setJudge('error','リセットに失敗しました','通信状態を確認してください');}});});
setInterval(()=>{if(state.work.work_id&&state.work.status==='current')render();},1000);
(async () => {
  try {
    const ctx = await window.appInit.ready(document.body.dataset.page);
    console.debug('[app-init]', {
      page: document.body.dataset.page,
      hasAppInit: !!window.appInit,
      hasFirestorePaths: !!window.firestorePaths,
      clientId: ctx.clientId,
      role: ctx.role,
      pathKeys: Object.keys(ctx.paths || {}),
    });
    window.renderSidebar?.();
    await init();
  } catch (error) {
    console.error('[inspection] init failed', error);

    if (typeof setJudge === 'function') {
      setJudge('error', '初期設定に失敗しました', 'ログイン状態またはテナント設定を確認してください。');
    }

    const syncStatus = document.getElementById('syncStatus');
    if (syncStatus) {
      syncStatus.textContent = '初期化失敗';
      syncStatus.className = 'inspection-status-badge inspection-status-badge--error';
    }

    const mainMsg = document.getElementById('mainMsgTxt');
    const subMsg = document.getElementById('judgeSubText');
    if (mainMsg) mainMsg.textContent = '初期設定に失敗しました';
    if (subMsg) subMsg.textContent = 'ログイン状態またはテナント設定を確認してください。';
  }
})();})();
