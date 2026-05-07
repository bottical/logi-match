(function(){
  const ALLOWED_ROLES = ['systemOwner'];
  const esc = (v)=>String(v ?? '').replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const toNumber = (value)=>{
    if (value == null || value === '') return 0;
    const n = Number(value);
    if (Number.isNaN(n)) throw new Error('sortOrder は数値で入力してください。');
    return n;
  };

  function assertInternalRole(ctx) {
    const role = ctx?.role || window.appContext?.role;
    if (!ALLOWED_ROLES.includes(role)) {
      throw new Error('この画面を利用する権限がありません。');
    }
  }

  function generateWorkerId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return [
      'worker_',
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds()),
    ].join('');
  }

  async function init(){
    const status = document.getElementById('status');
    const tbody = document.getElementById('workerRows');
    const tenantIdInput = document.getElementById('tenantId');
    const workerIdInput = document.getElementById('workerId');
    const workerNameInput = document.getElementById('workerName');
    const sortOrderInput = document.getElementById('sortOrder');
    const isActiveInput = document.getElementById('isActive');

    let hasPermission = false;
    try {
      const ctx = await window.appInit.ready(document.body.dataset.page);
      assertInternalRole(ctx);
      hasPermission = true;
      tenantIdInput.value = ctx?.tenantId || ctx?.clientId || '';
    } catch (error) {
      console.error('[internal-workers] init failed', error);
      status.textContent = error?.message || '初期化に失敗しました。';
      return;
    }

    if (!hasPermission) return;

    let rowMap = new Map();

    function setStatus(message){
      status.textContent = message;
    }

    function clearForm(){
      workerIdInput.value = '';
      workerNameInput.value = '';
      sortOrderInput.value = '';
      isActiveInput.checked = true;
    }

    async function appendOperationLog(tenantId, operationType, detail){
      try {
        await window.db.collection('clients').doc(tenantId).collection('operationLogs').add({
          operationType,
          targetType: 'worker',
          targetId: detail.workerId,
          userId: window.appContext?.uid || null,
          userEmail: window.appContext?.email || null,
          detail,
          operatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        console.warn('[internal-workers] operation log write failed', error);
      }
    }

    async function reload(){
      assertInternalRole(window.appContext);
      const tenantId = tenantIdInput.value.trim();
      if (!tenantId) throw new Error('tenantId を入力してください。');
      const snap = await window.db.collection('clients').doc(tenantId).collection('workers').get();
      const rows = snap.docs.map((doc) => {
        const data = doc.data() || {};
        return {
          workerId: doc.id,
          workerName: data.workerName || '',
          isActive: !!data.isActive,
          sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 0,
          updatedAt: data.updatedAt,
          disabledAt: data.disabledAt || null,
        };
      });
      rows.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        const nameComp = a.workerName.localeCompare(b.workerName, 'ja');
        if (nameComp !== 0) return nameComp;
        return a.workerId.localeCompare(b.workerId, 'ja');
      });
      rowMap = new Map(rows.map((row)=>[row.workerId, row]));
      tbody.innerHTML = rows.map((row)=>`<tr>
        <td>${esc(row.workerId)}</td>
        <td>${esc(row.workerName)}</td>
        <td>${row.isActive ? '有効' : '無効'}</td>
        <td>${esc(row.sortOrder)}</td>
        <td>${esc(row.updatedAt?.toDate?.()?.toLocaleString?.() || '')}</td>
        <td>
          <button type="button" data-action="edit" data-id="${esc(row.workerId)}">編集</button>
          <button type="button" data-action="toggle" data-id="${esc(row.workerId)}">${row.isActive ? '無効化' : '有効化'}</button>
        </td>
      </tr>`).join('');
    }

    document.getElementById('reload').addEventListener('click', async()=>{
      try { await reload(); setStatus('再読込しました。'); }
      catch (error) { setStatus(error.message || '再読込に失敗しました。'); }
    });

    document.getElementById('clear').addEventListener('click', ()=>{
      clearForm();
      setStatus('入力をクリアしました。');
    });

    document.getElementById('save').addEventListener('click', async()=>{
      try {
        assertInternalRole(window.appContext);
        const tenantId = tenantIdInput.value.trim();
        const workerName = workerNameInput.value.trim();
        const requestedId = workerIdInput.value.trim();
        const sortOrder = toNumber(sortOrderInput.value.trim());
        const isActive = !!isActiveInput.checked;
        if (!tenantId) throw new Error('tenantId を入力してください。');
        if (!workerName) throw new Error('作業者名を入力してください。');
        if (requestedId.includes('/')) throw new Error('workerId に / は使用できません。');
        const workerId = requestedId || generateWorkerId();
        const ref = window.db.collection('clients').doc(tenantId).collection('workers').doc(workerId);
        const snap = await ref.get();
        const now = window.firebase.firestore.FieldValue.serverTimestamp();
        const payload = { workerId, workerName, isActive, sortOrder, updatedAt: now };
        if (!snap.exists) {
          payload.createdAt = now;
          payload.disabledAt = isActive ? null : now;
        } else {
          payload.disabledAt = isActive ? null : now;
        }
        await ref.set(payload, { merge: true });
        await appendOperationLog(tenantId, !snap.exists ? 'worker_create' : 'worker_update', { workerId, workerName, isActive, sortOrder });
        setStatus(`保存しました: ${workerId}`);
        workerIdInput.value = workerId;
        await reload();
      } catch (error) {
        setStatus(error.message || '保存に失敗しました。');
      }
    });

    tbody.addEventListener('click', async(event)=>{
      const btn = event.target.closest('button[data-action][data-id]');
      if (!btn) return;
      const workerId = btn.dataset.id;
      const action = btn.dataset.action;
      const row = rowMap.get(workerId);
      if (!row) return;

      if (action === 'edit') {
        workerIdInput.value = row.workerId;
        workerNameInput.value = row.workerName;
        sortOrderInput.value = String(row.sortOrder ?? 0);
        isActiveInput.checked = !!row.isActive;
        setStatus(`編集中: ${row.workerId}`);
        return;
      }

      if (action === 'toggle') {
        try {
          assertInternalRole(window.appContext);
          const tenantId = tenantIdInput.value.trim();
          if (!tenantId) throw new Error('tenantId を入力してください。');
          const nextActive = !row.isActive;
          const now = window.firebase.firestore.FieldValue.serverTimestamp();
          await window.db.collection('clients').doc(tenantId).collection('workers').doc(workerId).set({
            isActive: nextActive,
            disabledAt: nextActive ? null : now,
            updatedAt: now,
          }, { merge: true });
          await appendOperationLog(tenantId, nextActive ? 'worker_enable' : 'worker_disable', {
            workerId,
            workerName: row.workerName,
            isActive: nextActive,
            sortOrder: row.sortOrder,
          });
          setStatus(`${workerId} を${nextActive ? '有効化' : '無効化'}しました。`);
          await reload();
        } catch (error) {
          setStatus(error.message || '状態更新に失敗しました。');
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
