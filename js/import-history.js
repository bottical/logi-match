(function(){
const $=id=>document.getElementById(id);
if(!$('historyRows'))return;

function toDate(v){if(!v)return null;if(typeof v.toDate==='function')return v.toDate();const d=new Date(v);return Number.isNaN(d.getTime())?null:d;}
function toMillis(v){const d=toDate(v);return d?d.getTime():0;}
function fmt(v){const d=toDate(v);return d?d.toLocaleString('ja-JP'):'-';}
function num(v,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback;}

function appendRow(host,r){
  const details=document.createElement('details');
  const summary=document.createElement('summary');
  const importedAt=r.importedAt||r.imported_at;
  const fileName=r.fileName||r.source_file_name||r.sourceFileName||'-';
  const importedBy=r.importedBy||r.imported_by||'-';
  const newWorkCount=num(r.newWorkCount??r.success_work_count);
  const overwrittenWorkCount=num(r.overwrittenWorkCount);
  const skippedWorkCount=num(r.skippedWorkCount);
  const normalItemCount=num(r.normalItemCount??r.success_detail_count);
  const excludedItemCount=num(r.excludedItemCount);
  const errorCount=num(r.errorCount??r.error_count);
  const warningCount=num(r.warningCount??r.warning_count);
  summary.textContent=`${fmt(importedAt)} / ${fileName} / ${importedBy} / ${r.status||'-'} / 新規${newWorkCount} / 上書き${overwrittenWorkCount} / スキップ${skippedWorkCount} / 明細${normalItemCount} / 対象外${excludedItemCount} / エラー${errorCount} / 警告${warningCount}`;
  const pre=document.createElement('pre');
  pre.textContent=JSON.stringify({errors:r.errorDetails||r.errors||[],warnings:r.warningDetails||r.warnings||[]},null,2);
  details.append(summary,pre);
  host.appendChild(details);
}
function getClientCollection(db,clientId,name){if(!db)throw new Error('Firestore db is not initialized');if(!clientId)throw new Error('clientId is required');if(!name)throw new Error('collection name is required');return db.collection('clients').doc(clientId).collection(name);}
function renderEmpty(msg){$('historyRows').replaceChildren();$('historyStatus').textContent=msg||'データはまだありません。';}
function renderError(userMessage,detail){$('historyStatus').textContent=userMessage;const host=$('historyRows');host.replaceChildren();const p=document.createElement('p');p.className='error-detail';p.textContent=`詳細: ${detail}`;host.appendChild(p);}
function showInitError(error){const message=error?.message||String(error);let userMessage='初期設定に失敗しました。';if(message.includes('clientId'))userMessage='ログインユーザーに clientId が設定されていません。管理者に確認してください。';else if(message.includes('USER_NOT_REGISTERED')||message.includes('ユーザー設定'))userMessage='ログインユーザー設定が未作成です。管理者に確認してください。';else if(message.includes('permission-denied')||message.includes('PERMISSION_DENIED'))userMessage='利用権限またはテナント設定に問題があります。管理者に確認してください。';renderError(userMessage,message);}
async function loadImportHistory(ctx){$('historyStatus').textContent='読込中...';const snap=await getClientCollection(ctx.db,ctx.clientId,'importBatches').limit(100).get();if(snap.empty){renderEmpty('マスター投入履歴はまだありません。');return;}const rows=snap.docs.map(d=>({id:d.id,...d.data()}));rows.sort((a,b)=>toMillis(b.importedAt||b.imported_at)-toMillis(a.importedAt||a.imported_at));const host=$('historyRows');host.replaceChildren();rows.forEach(r=>appendRow(host,r));$('historyStatus').textContent=`${rows.length}件`;}
async function init(){try{const ctx=await window.appInit.ready(document.body.dataset.page);if(!ctx)return;console.log('[import-history] context',{uid:ctx.uid||ctx.userId,clientId:ctx.clientId,role:ctx.role});window.renderSidebar?.();await loadImportHistory(ctx);}catch(e){console.error('[import-history] init failed',e);showInitError(e);}}
document.addEventListener('DOMContentLoaded',init);
})();
