(() => {
  const state = window.inspectionState;
  const $ = (id) => document.getElementById(id);
  const statusMap = { unstarted:'未着手', current:'作業中', suspended:'中断', completed:'完了', locked:'ロック中' };
  const syncMap = { idle:['待機中','idle'], saving:['同期中','saving'], saved:['保存済み','saved'], failed:['保存失敗','failed'], offline:['オフライン','offline'] };

  function focusScanInput(){ requestAnimationFrame(() => { const input = $('scanCodeInput'); if (input && !input.disabled) { input.focus(); input.select(); } }); }
  function playSound(kind){ try { if (window.AudioManager?.play) window.AudioManager.play(kind); } catch (_) {} }
  function sortedDetails(){ return [...state.details].sort((a,b)=> rank(a)-rank(b) || a.product_name.localeCompare(b.product_name,'ja')); }
  function rank(d){ if (!d.completed_flag && d.actual_qty>0) return 0; if (d.actual_qty===0) return 1; if (d.completed_flag) return 2; return 3; }

  function setJudge(type, main, sub=''){ const panel=$('judgePanel'); panel.className = `inspection-judge inspection-judge--${type}`; $('mainMsgTxt').textContent = main; $('judgeSubText').textContent = sub; panel.classList.remove('inspection-flash'); void panel.offsetWidth; panel.classList.add('inspection-flash'); }
  function renderHeader(){
    $('workId').textContent = state.work.work_id ?? '-'; $('recipientName').textContent = state.work.recipient_name ?? '-';
    $('workStatus').textContent = statusMap[state.work.status] ?? state.work.status;
    $('workerId').textContent = state.work.current_worker_id ?? '-';
    const skuDone = state.details.filter(d=>d.completed_flag).length;
    const totalActual = state.details.reduce((n,d)=>n+d.actual_qty,0); const totalTarget = state.details.reduce((n,d)=>n+d.target_qty,0);
    $('skuProgress').textContent = `${skuDone} / ${state.details.length}`; $('qtyProgress').textContent = `${totalActual} / ${totalTarget}`;
    const [label,klass]=syncMap[state.syncStatus]; $('syncStatus').textContent=label; $('syncStatus').className=`inspection-status-badge inspection-status-badge--${klass}`;
    $('scanCodeInput').disabled = state.lock.locked;
    $('completeButton').disabled = true;
  }
  function renderDetail(){ const host=$('detailPanel'); const d = state.recentScan?.detail;
    if (!d) { host.textContent = '直近スキャン商品はありません。'; return; }
    host.replaceChildren();
    const dl = document.createElement('dl');
    const rows = [['商品名',d.product_name],['商品ID',d.product_id],['読取コード',state.recentScan.scanCode],['コード種別',state.recentScan.isAlt?'代替コード読取':'メインバーコード'],['実績 / 指示',`${d.actual_qty} / ${d.target_qty}`],['残数',String(d.target_qty-d.actual_qty)],['明細状態',d.completed_flag?'完了':(d.actual_qty>0?'検品中':'未着手')]];
    rows.forEach(([k,v])=>{ const dt=document.createElement('dt'); dt.textContent=k; const dd=document.createElement('dd'); dd.textContent=v; dl.append(dt,dd); }); host.append(dl);
  }
  function renderList(){ const ul=$('detailList'); ul.replaceChildren(); sortedDetails().forEach(d=>{ const li=document.createElement('li');
      let c='inspection-item '; c += d.completed_flag?'inspection-item--done':(d.actual_qty>0?'inspection-item--active':'inspection-item--pending');
      if (state.recentScan?.detail?.detail_id===d.detail_id) c += ' inspection-item--recent'; li.className=c;
      li.textContent = `[${d.completed_flag?'完了':(d.actual_qty>0?'検品中':'未着手')}] ${d.product_name} (${d.product_id}) / ${d.main_barcode} / 実績 ${d.actual_qty} / 指示 ${d.target_qty} / 残 ${d.target_qty-d.actual_qty}`;
      ul.append(li);
  }); }
  function render(){ renderHeader(); renderDetail(); renderList(); }

  async function persistAsync(reason, payload = {}) {
    state.syncStatus='saving'; renderHeader();
    try {
      if (typeof window.saveInspectionState === 'function') {
        await window.saveInspectionState(state, { reason, payload });
      } else {
        console.warn('[inspection] saveInspectionState is not implemented. skipped.');
      }
      state.syncStatus='saved'; renderHeader();
    } catch (error) {
      console.error('[inspection] persist failed', error);
      state.syncStatus='failed'; renderHeader();
      $('judgeSubText').textContent = '保存失敗：再読取せず管理者へ確認（同期失敗により一時停止）';
      state.lock = { locked: true, reason: 'sync-error', worker_id: null, started_at: new Date().toISOString() };
      setJudge('locked', '同期失敗により停止中', '直前の読取結果は画面上に反映済みです。再読取せず管理者へ確認してください');
      renderHeader();
      playSound('warning'); focusScanInput();
    }
  }

  function resetQtyMode(){ state.qtyMode.enabled=false; $('qtyModeToggle').checked=false; $('scanQtyInput').disabled=true; $('scanQtyInput').value='1'; }

  function runScan(){ if (state.lock.locked){ if (state.lock.reason === 'sync-error') { setJudge('locked','同期失敗により停止中','直前の読取結果は画面上に反映済みです。再読取せず管理者へ確認してください'); } else { setJudge('locked','他の作業者が作業中',`${state.lock.worker_id ?? '-'} ${state.lock.started_at ?? ''}`); } playSound('warning'); focusScanInput(); return; }
    const raw = $('scanCodeInput').value.trim(); if (!raw) { focusScanInput(); return; }
    $('scanCodeInput').value = '';
    const qty = state.qtyMode.enabled ? Number($('scanQtyInput').value) : 1;
    if (!Number.isInteger(qty) || qty <= 0) { setJudge('error','数量エラー','数量入力モードの値を確認してください'); playSound('ng'); resetQtyMode(); focusScanInput(); return; }
    const detail = state.details.find(d => d.scan_code===raw || d.main_barcode===raw || d.alt_code===raw);
    if (!detail){ setJudge('error','対象外コード','一致する明細がありません'); playSound('ng'); resetQtyMode(); focusScanInput(); render(); return; }
    if (detail.actual_qty + qty > detail.target_qty){ setJudge('error','指示数超過',`${detail.product_name} 現在:${detail.actual_qty} 指示:${detail.target_qty} 加算:${qty}`); playSound('ng'); resetQtyMode(); focusScanInput(); return; }
    detail.actual_qty += qty; detail.completed_flag = detail.actual_qty === detail.target_qty;
    state.recentScan = { scanCode: raw, detail, isAlt: detail.main_barcode!==raw, at: Date.now() };
    state.work.status = 'current';
    const allDone = state.details.every(d=>d.completed_flag);
    if (allDone){ state.work.completed_flag = true; state.work.status = 'completed'; setJudge('ok','作業完了','全明細が完了しました'); playSound('strong-complete'); }
    else if (detail.completed_flag){ setJudge('complete','明細完了',detail.product_name); playSound('complete'); }
    else { setJudge('ok','OK',detail.product_name); playSound('ok'); }
    resetQtyMode(); render(); persistAsync('scan', { scanCode: raw, detailId: detail.detail_id, qtyDelta: qty }); focusScanInput(); }

  function confirmAction(message, onOk){ const d=$('confirmDialog');
    const close=()=>{ $('confirmOk').onclick=null; $('confirmCancel').onclick=null; d.close?.(); focusScanInput(); };
    $('confirmMessage').textContent=message;
    $('confirmOk').onclick=()=>{ onOk(); close(); };
    $('confirmCancel').onclick=close;
    if (typeof d.showModal === 'function') d.showModal();
    else if (window.confirm(message)) $('confirmOk').onclick(); else close();
  }

  $('scanSubmitButton').addEventListener('click', runScan);
  $('scanCodeInput').addEventListener('keydown',(e)=>{ if (e.key==='Enter'){ e.preventDefault(); runScan(); }});
  $('qtyModeToggle').addEventListener('change',(e)=>{ state.qtyMode.enabled=e.target.checked; $('scanQtyInput').disabled=!state.qtyMode.enabled; if (state.qtyMode.enabled) $('scanQtyInput').focus(); else focusScanInput(); });
  $('pauseButton').addEventListener('click',()=>confirmAction('この作業を中断します。よろしいですか？',()=>{ state.work.status='suspended'; state.lock={locked:false,reason:null,worker_id:null,started_at:null}; setJudge('warning','中断','作業を中断しました'); render(); persistAsync('suspend'); }));
  $('resetButton').addEventListener('click',()=>confirmAction('この作業の検品実績をすべて0に戻します。\nこの操作は現場作業に影響します。実行してよろしいですか？',()=>{ state.details.forEach(d=>{d.actual_qty=0; d.completed_flag=false;}); state.work.status='unstarted'; state.work.completed_flag=false; state.recentScan=null; setJudge('warning','リセット完了','実績を初期化しました'); render(); persistAsync('reset'); }));
  $('completeButton').addEventListener('click',()=>confirmAction('検品を完了します。よろしいですか？',()=>{ if (!state.details.every(d=>d.completed_flag)) return; state.work.status='completed'; state.work.completed_flag=true; setJudge('ok','作業完了','完了処理を実行しました'); playSound('strong-complete'); render(); persistAsync('complete'); }));

  render(); focusScanInput();
})();
