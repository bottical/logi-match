(function(){
 const $=id=>document.getElementById(id); if(!$('workTableBody')) return;
 const statusMap={unstarted:'未着手',current:'作業中',suspended:'中断',completed:'完了'}; const LIMIT=300;
 const fmt=v=>{if(!v) return '-'; const d=new Date(v); return Number.isNaN(d)?String(v):d.toLocaleString('ja-JP');};
 const importKey=r=>r.import_date_key||r.work?.import_date_key||String(r.work?.import_date||'').slice(0,10);
 const statusOf=r=>r.status||r.work?.status||'';

 function renderRows(rows){ const body=$('workTableBody'); body.replaceChildren();
  rows.forEach(r=>{const d=Array.isArray(r.details)?r.details:[]; const skuDone=d.filter(x=>x.completed_flag).length; const qa=d.reduce((n,x)=>n+Number(x.actual_qty||0),0); const qt=d.reduce((n,x)=>n+Number(x.target_qty||0),0); const action=statusOf(r)==='completed'?'表示':(statusOf(r)==='suspended'?'再開':'検品開始'); const tr=document.createElement('tr');
   [r.work_id||r.work?.work_id||'',r.work?.recipient_name||'',statusMap[statusOf(r)]||statusOf(r),`${skuDone}/${d.length}`,`${qa}/${qt}`,fmt(r.import_date||r.work?.import_date),fmt(r.work?.completed_at),r.work?.current_worker_id||'-'].forEach(v=>{const td=document.createElement('td'); td.textContent=String(v); tr.appendChild(td);});
   const td=document.createElement('td'); const a=document.createElement('a'); a.className='btn-link'; a.href=`inspection.html?work_id=${encodeURIComponent(r.work_id||r.work?.work_id||'')}`; a.textContent=action; td.appendChild(a); tr.appendChild(td); body.appendChild(tr); });
 }

 async function queryRows(useLimit=true){ let q=window.db.collection('inspectionWorks'); if(useLimit) q=q.limit(LIMIT); const s=$('filterStatus').value; if(s) q=q.where('status','==',s); const snap=await q.get(); return snap.docs.map(d=>d.data()).filter(r=>r?.deleted_flag!==true&&r?.work?.deleted_flag!==true); }

 async function load(){ if(!window.db){$('listStatus').textContent='Firebase未接続';return;} $('listStatus').textContent='読込中...'; const kw=$('filterWorkId').value.trim(); let rows=[];
  if(kw){ const exact=await window.db.collection('inspectionWorks').doc(kw).get(); const filterStatus=$('filterStatus').value; if(exact.exists){ const row=exact.data(); const notDeleted=row?.deleted_flag!==true && row?.work?.deleted_flag!==true; const statusMatch=!filterStatus || statusOf(row)===filterStatus; rows=(notDeleted && statusMatch)?[row]:[]; } else { rows=await queryRows(true); rows=rows.filter(r=>String(r.work_id||r.work?.work_id||'').startsWith(kw)); if(!rows.length) $('listStatus').textContent='該当なし'; }}
  else rows=await queryRows(true);
  const from=$('filterFrom').value,to=$('filterTo').value; rows=rows.filter(r=>{const k=importKey(r); if(from&&k<from)return false; if(to&&k>to)return false; return true;}); rows.sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
  renderRows(rows); if(!$('listStatus').textContent || $('listStatus').textContent==='読込中...') $('listStatus').textContent=`${rows.length}件表示`;
 }
 function esc(v){return '"'+String(v??'').replaceAll('"','""')+'"';}
 async function queryExportRows(from,to){
  let q=window.db.collection('inspectionWorks').where('deleted_flag','==',false);
  if(from) q=q.where('import_date_key','>=',from);
  if(to) q=q.where('import_date_key','<=',to);
  q=q.orderBy('import_date_key');
  const snap=await q.get();
  return snap.docs.map(d=>d.data()).filter(r=>r?.deleted_flag!==true&&r?.work?.deleted_flag!==true);
 }
 async function exportCsv(){ if(!window.db) return; const from=$('logFrom').value,to=$('logTo').value; let rows=[]; try { rows=await queryExportRows(from,to); } catch (e) { console.error('[export] query failed', e); $('listStatus').textContent='Firestoreインデックス設定が必要です'; return; }
  const headers=['取込日','作業ID','お届け先名','ステータス','完了フラグ','開始時刻','完了時刻','current作業者','明細数','完了明細数','指示数量合計','実績数量合計','リセット回数'];
  const lines=[headers.map(esc).join(',')]; rows.forEach(r=>{const w=r.work||{}; const d=Array.isArray(r.details)?r.details:[]; const skuDone=d.filter(x=>x.completed_flag).length; const qa=d.reduce((n,x)=>n+Number(x.actual_qty||0),0); const qt=d.reduce((n,x)=>n+Number(x.target_qty||0),0); lines.push([w.import_date||r.import_date||'',w.work_id||r.work_id||'',w.recipient_name||'',statusMap[statusOf(r)]||statusOf(r),String(!!w.completed_flag),w.started_at||'',w.completed_at||'',w.current_worker_id||'',d.length,skuDone,qt,qa,w.reset_count??0].map(esc).join(',')); });
  const filename=`inspection_log_${(from||'all').replaceAll('-','')}_${(to||'all').replaceAll('-','')}.csv`; const blob=new Blob(['\uFEFF'+lines.join('\n')],{type:'text/csv;charset=utf-8;'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); URL.revokeObjectURL(a.href);
 }
 $('searchButton').addEventListener('click',load); $('reloadButton').addEventListener('click',load); $('exportButton').addEventListener('click',exportCsv);
 window.inspectionList={reload:load}; load();
})();
