(()=>{
const state=window.inspectionState,$=id=>document.getElementById(id),statusMap={unstarted:'未着手',current:'作業中',suspended:'中断',completed:'完了'},syncMap={idle:['待機中','idle'],saving:['同期中','saving'],saved:['保存済み','saved'],failed:['保存失敗','failed']};
const DETAIL_TABLE_COLUMNS=[{key:'status',label:'状態',type:'state'},{key:'main_barcode',label:'JAN下4桁',type:'jan4'},{key:'product_name',label:'商品名',fallbackKeys:['productName','itemName','商品名']},{key:'target_qty',label:'予定数量',type:'target'},{key:'actual_qty',label:'実績数量',type:'actual'},{key:'remaining',label:'残数',type:'remaining'}];
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
const findDetailByScanCode=(details,code)=>{
 const raw=normalize(code);
 for(const d of details){
  if(isExcludedDetail(d)) continue;
  const keys=getScanKeys(d);
  if(keys.some(k=>k.type==='jan'&&k.value===raw)) return {detail:d,codeType:'jan'};
 }
 for(const d of details){
  if(isExcludedDetail(d)) continue;
  const keys=getScanKeys(d);
  if(keys.some(k=>k.type==='alternative'&&k.value===raw)) return {detail:d,codeType:'alternative'};
 }
 return null;
};
const getTargetQty=d=>Number(d?.target_qty ?? d?.targetQty ?? 0);
const getActualQty=d=>Number(d?.actual_qty ?? d?.actualQty ?? 0);
const setActualQty=(d,v)=>{ if(Object.prototype.hasOwnProperty.call(d,'actual_qty')) d.actual_qty=v; else d.actualQty=v; };
const isExcludedDetail=d=>d?.inspectionRequired===false||d?.inspection_required===false||getTargetQty(d)===0;
const user=()=>window.appContext?.uid||window.auth?.currentUser?.uid||'unknown-user';
const selectedWorker=()=>window.workerContext?.selectedWorker;
const playSound=(k)=>{try{if(window.AudioManager?.play)window.AudioManager.play(k);}catch(_){}};
const setJudge=(t,m,s='')=>{$('judgePanel').className=`inspection-judge inspection-judge--${t}`;$('mainMsgTxt').textContent=m;$('judgeSubText').textContent=s;};
const focusPickingNoInput=()=>requestAnimationFrame(()=>{$('pickingNoInput').focus();$('pickingNoInput').select();});
const focusJanInput=()=>requestAnimationFrame(()=>{if(!$('scanCodeInput').disabled){$('scanCodeInput').focus();$('scanCodeInput').select();}});
const rank=d=>state.recentScan?.detail?.detail_id===d.detail_id?-1:(!d.completed_flag&&d.actual_qty>0?0:d.actual_qty===0?1:2);
const pickValue=(obj,keys)=>{for(const k of keys||[]){if(obj&&obj[k]!=null&&obj[k]!=='')return obj[k];}return '';};
const display=value=>value==null||value===''?'-':value;
const secToClock=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

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
 $('scanQtyInput').disabled=!isLoaded;
 $('topStatusText').textContent=state.work.status==='completed'?'完了':(isLoaded?'JANスキャン待ち':'ピッキングNo.待ち');
 const sorted=[...state.details].sort((a,b)=>rank(a)-rank(b)||String(a.product_name||'').localeCompare(String(b.product_name||''),'ja'));
 const head=$('detailTableHead');const body=$('detailTableBody');head.replaceChildren();body.replaceChildren();
 DETAIL_TABLE_COLUMNS.forEach(c=>{const th=document.createElement('th');th.textContent=c.label;head.appendChild(th);});
 sorted.forEach(d=>{const tr=document.createElement('tr');const excluded=isExcludedDetail(d);let cls='detail-row--pending';if(excluded){cls='detail-row--excluded';}else if(state.recentScan?.detail?.detail_id===d.detail_id){cls='detail-row--recent';}else if(d.error_flag){cls='detail-row--error';}else if(d.completed_flag){cls='detail-row--done';}else if(getActualQty(d)>0){cls='detail-row--partial';}tr.className=cls;
 DETAIL_TABLE_COLUMNS.forEach(c=>{const td=document.createElement('td');if(c.type==='state')td.textContent=excluded?'検品対象外':(d.completed_flag?'完了':(getActualQty(d)>0?'途中':'未着手'));else if(c.type==='target')td.textContent=String(getTargetQty(d));else if(c.type==='actual')td.textContent=String(getActualQty(d));else if(c.type==='remaining')td.textContent=excluded?'-':String(getTargetQty(d)-getActualQty(d));else if(c.type==='jan4'){const jan=String(pickValue(d,['main_barcode','scan_code','barcode','JAN'])||'');td.textContent=jan?jan.slice(-4):'-';td.title=jan||'';}else td.textContent=display(pickValue(d,[c.key,...(c.fallbackKeys||[])]));tr.appendChild(td);});body.appendChild(tr);});
 const summaryPanel=$('lastCompletedSummaryPanel');const summaryText=$('lastCompletedSummaryText');if(summaryPanel&&summaryText){summaryPanel.hidden=!state.lastCompletedSummary;summaryText.textContent=state.lastCompletedSummary||'';}
}
async function safeAppendScanLog(workId,log){try{await window.appendScanLog(workId,log);}catch(e){console.error('[scanLog] failed',e);}}
async function persistAsync(reason,payload={}){state.syncStatus='saving';render();try{await window.saveInspectionState(state,{reason,payload});state.syncStatus='saved';render();return true;}catch(e){state.syncStatus='failed';state.lock={locked:true,reason:'sync-error',worker_id:null,started_at:new Date().toISOString()};setJudge('locked','同期失敗により停止中','再読取せず管理者へ確認してください');render();playSound('warning');return false;}}
function resetToPickingNoInput(options={}){const summary=options.completedSummary||state.lastCompletedSummary;Object.assign(state,blank());state.lastCompletedSummary=summary;$('pickingNoInput').disabled=false;$('scanCodeInput').disabled=true;$('scanQtyInput').value='1';$('pauseButton').disabled=true;$('resetButton').disabled=true;setJudge(options.completed?'complete':'idle',options.completed?'検品完了':'ピッキングNo.待ち',options.completed?'次のピッキングNo.を入力してください':(selectedWorker()?'次のピッキングNo.を入力してください':'作業者を選択してください'));render();focusPickingNoInput();}
function confirmAction(message,onOk){const d=$('confirmDialog');const cleanup=()=>{ $('confirmOk').onclick=null;$('confirmCancel').onclick=null;d.close?.();};const focusBack=()=>{if(state.work.work_id&&!$('scanCodeInput').disabled)focusJanInput();else focusPickingNoInput();};$('confirmMessage').textContent=message;$('confirmOk').onclick=()=>{cleanup();onOk();};$('confirmCancel').onclick=()=>{cleanup();focusBack();};if(typeof d.showModal==='function')d.showModal();else if(window.confirm(message))$('confirmOk').onclick();else $('confirmCancel').onclick();}
async function loadPickingNo(v){const workId=String(v||'').trim();$('pickingNoInput').value=workId;if(!workId){resetToPickingNoInput();return;}setJudge('idle','読込中','');$('scanCodeInput').disabled=true;render();const loaded=await window.loadInspectionState(workId);if(!loaded){setJudge('error','エラー','該当するピッキングNo.がありません');playSound('warning');focusPickingNoInput();return;}Object.assign(state,loaded);state.startedAt=Date.now();if(state.work.status==='completed'||state.work.completed_flag){await safeAppendScanLog(workId,{workId,pickingNo:workId,scannedCode:workId,codeType:'unknown',result:'completed_work',errorMessage:'検品完了済み',inputQty:0,beforeQty:null,afterQty:null,targetQty:null,workerId:selectedWorker()?.workerId||null,workerNameSnapshot:selectedWorker()?.workerName||null,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web'});state.work.status='completed';$('scanCodeInput').disabled=true;$('pauseButton').disabled=true;$('resetButton').disabled=true;setJudge('locked','完了済み','このピッキングNo.はすでに完了しています');render();playSound('warning');focusPickingNoInput();return;}if(!state.details.length){setJudge('error','エラー','このピッキングNo.には検品対象がありません');render();focusPickingNoInput();return;}if(!selectedWorker()){setJudge('warning','作業者を選択してください','');focusPickingNoInput();return;}const lock=await window.acquireWorkLock(workId,{workerId:selectedWorker().workerId,workerName:selectedWorker().workerName,loginUid:window.appContext.uid,loginEmail:window.appContext.email});if(!lock.ok){await safeAppendScanLog(workId,{workId,pickingNo:workId,scannedCode:workId,codeType:'unknown',result:'locked',errorMessage:'他作業者ロック中',inputQty:0,beforeQty:null,afterQty:null,targetQty:null,workerId:selectedWorker()?.workerId||null,workerNameSnapshot:selectedWorker()?.workerName||null,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web'});setJudge('locked','他の作業者が作業中です',`${lock.workerId||'-'} ${lock.startedAt||''}`);$('scanCodeInput').disabled=true;render();focusPickingNoInput();return;}state.work.status='current';state.work.current_worker_id=selectedWorker().workerId;state.work.current_worker_name=selectedWorker().workerName;state.work.current_login_uid=window.appContext.uid;state.work.current_login_email=window.appContext.email;state.lock={locked:false,reason:null,worker_id:null,started_at:null};$('scanCodeInput').disabled=false;$('pauseButton').disabled=false;$('resetButton').disabled=false;setJudge('working','スキャン待ち','JAN / 代替コードをスキャンしてください');render();focusJanInput();}
async function runScan(){ if(!selectedWorker()){setJudge('warning','作業者を選択してください','');playSound('warning');focusPickingNoInput();return;}if(!state.work.work_id||$('scanCodeInput').disabled){setJudge('warning','ピッキングNo.待ち','次のピッキングNo.をスキャンしてください');focusPickingNoInput();return;}const raw=$('scanCodeInput').value.trim();if(!raw)return;$('scanCodeInput').value='';const qty=Number($('scanQtyInput').value);
 if(!Number.isInteger(qty)||qty<=0){await safeAppendScanLog(state.work.work_id,{workId:state.work.work_id,pickingNo:state.work.work_id,scannedCode:raw,codeType:'unknown',result:'invalid',errorMessage:'数量不正',inputQty:qty,beforeQty:null,afterQty:null,targetQty:null,workerId:selectedWorker().workerId,workerNameSnapshot:selectedWorker().workerName,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web'});setJudge('error','数量エラー','読取数量を確認してください');playSound('ng');$('scanQtyInput').value='1';focusJanInput();return;}
 const matched=findDetailByScanCode(state.details,raw);const detail=matched?.detail;if(!detail){await safeAppendScanLog(state.work.work_id,{workId:state.work.work_id,pickingNo:state.work.work_id,scannedCode:raw,codeType:'unknown',result:'not_found',errorMessage:'対象外コード',inputQty:qty,beforeQty:null,afterQty:null,targetQty:null,workerId:selectedWorker().workerId,workerNameSnapshot:selectedWorker().workerName,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web'});setJudge('error','対象外コードです',`読取コード：${raw}`);playSound('ng');$('scanQtyInput').value='1';focusJanInput();return;}
// NOTE: This is a UI pre-check from local state. Final quantity integrity is enforced in applyScanTransaction().
const beforeQty=getActualQty(detail), targetQty=getTargetQty(detail);if(beforeQty+qty>targetQty){await safeAppendScanLog(state.work.work_id,{workId:state.work.work_id,pickingNo:state.work.work_id,scannedCode:raw,codeType:matched?.codeType||'unknown',result:'over_qty',errorMessage:'必要数超過',inputQty:qty,beforeQty,afterQty:beforeQty,targetQty,workerId:selectedWorker().workerId,workerNameSnapshot:selectedWorker().workerName,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web'});setJudge('error','必要数を超えています','数量を確認してください');playSound('ng');$('scanQtyInput').value='1';focusJanInput();return;}
 const applied=await window.applyScanTransaction?.({workId:state.work.work_id,scannedCode:raw,inputQty:qty,workerId:selectedWorker().workerId,workerName:selectedWorker().workerName,userId:window.appContext.uid,deviceId:window.appContext.deviceId||'web'});if(!applied?.ok){setJudge('error','同期エラー',applied?.message||'再度読み取ってください');playSound('ng');$('scanQtyInput').value='1';focusJanInput();return;}
 Object.assign(state,applied.state);const updated=state.details.find(x=>x.detail_id===applied.detailId)||detail;state.lastScannedCode=raw;state.recentScan={scanCode:raw,detail:updated,at:Date.now()};const remain=getTargetQty(updated)-getActualQty(updated);
 setJudge('ok',`OK ${updated.product_name||''} +${qty}`,`数量 ${getActualQty(updated)} / ${getTargetQty(updated)}  残り ${remain}`);
 const allDone=state.details.filter(d=>!isExcludedDetail(d)).every(d=>d.completed_flag);if(allDone){const activeDetails=state.details.filter(d=>!isExcludedDetail(d));const excludedCount=state.details.length-activeDetails.length;const targetTotal=activeDetails.reduce((n,d)=>n+getTargetQty(d),0);state.lastCompletedSummary=`${state.work.work_id} / 対象SKU ${activeDetails.length}件 / 対象数量 ${targetTotal}点 / 対象外 ${excludedCount}件`;playSound('strong-complete');render();$('scanQtyInput').value='1';resetToPickingNoInput({completed:true,completedSummary:state.lastCompletedSummary});return;}
 playSound(updated.completed_flag?'complete':'ok');render();$('scanQtyInput').value='1';focusJanInput();}
async function init(){resetToPickingNoInput();$('headerUserName')?.remove();
 const workerSelect=$('workerSelect');const workers=await window.loadWorkers(window.appContext.tenantId);
 if(window.setWorkerList)window.setWorkerList(workers);
 workers.forEach(w=>{const o=document.createElement('option');o.value=w.workerId;o.textContent=`${w.workerCode||''} ${w.workerName||w.workerId}`;workerSelect.appendChild(o);});
 const restored=window.restoreSelectedWorker?.(window.appContext.tenantId);
 if(restored?.workerId){
  workerSelect.value=restored.workerId;
  $('workerDisplayName').textContent=restored.workerName||restored.workerId;
  setJudge('idle','ピッキングNo.待ち','次のピッキングNo.を入力してください');
  render();
  focusPickingNoInput();
 }else{
  $('workerDisplayName').textContent='未選択';
  setJudge('warning','作業者を選択してください','作業者を選択してください');
  render();
 }
 workerSelect.addEventListener('change',()=>{
  const worker=window.selectWorker(window.appContext.tenantId,workerSelect.value);
  $('workerDisplayName').textContent=worker?.workerName||worker?.workerId||'未選択';
  workerSelect.hidden=true;
  if(!state.work.work_id){
   if(worker){
    setJudge('idle','ピッキングNo.待ち','次のピッキングNo.を入力してください');
    render();
    focusPickingNoInput();
   }else{
    setJudge('warning','作業者を選択してください','作業者を選択してください');
    render();
   }
  }
 });
 $('workerChangeButton').addEventListener('click',()=>{workerSelect.hidden=!workerSelect.hidden;if(!workerSelect.hidden)workerSelect.focus();});
 const id=new URLSearchParams(location.search).get('work_id');
 if(id){$('pickingNoInput').value=id;await loadPickingNo(id);}
}
$('loadPickingButton').addEventListener('click',()=>loadPickingNo($('pickingNoInput').value));$('pickingNoInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();loadPickingNo($('pickingNoInput').value);}});$('scanCodeInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runScan();}});$('scanSubmitButton').addEventListener('click',runScan);
$('pauseButton').addEventListener('click',()=>confirmAction('この作業を中断します。よろしいですか？',async()=>{state.work.status='suspended';state.work.suspended_at=new Date().toISOString();state.work.current_worker_id=null;state.work.current_worker_name=null;state.work.current_login_uid=null;state.work.current_login_email=null;const ok=await persistAsync('suspend');if(ok)resetToPickingNoInput();}));
$('resetButton').addEventListener('click',()=>confirmAction('このピッキングNo.の検品実績をリセットします。\n読取済み数量も初期化されます。\n本当に実行しますか？',async()=>{state.details.forEach(d=>{d.actual_qty=0;d.completed_flag=false;});state.work.status='unstarted';state.work.completed_flag=false;state.work.current_worker_id=null;state.work.current_worker_name=null;state.work.current_login_uid=null;state.work.current_login_email=null;const ok=await persistAsync('reset');if(ok)resetToPickingNoInput();}));
setInterval(()=>{if(state.work.work_id&&state.work.status==='current')render();},1000);
(async()=>{await window.initializeAppContext('inspection');window.renderSidebar?.();await init();})();})();
