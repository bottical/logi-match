(function(){
  const VALID_ROLES = ['worker', 'admin', 'owner', 'systemOwner'];
  const esc = (v)=>String(v ?? '').replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  function validateUserPayload(payload) {
    if (!payload.uid) throw new Error('UID_REQUIRED');
    if (!payload.tenantId) throw new Error('TENANT_ID_REQUIRED');
    if (!VALID_ROLES.includes(payload.role)) throw new Error('INVALID_ROLE');
    if (typeof payload.active !== 'boolean') throw new Error('INVALID_ACTIVE');
  }
  function denyAccess() { const panel = document.querySelector('.panel'); if (panel) panel.innerHTML = '<h2>権限がありません</h2><p>この画面は弊社管理者専用です。</p>'; }
  async function init(){
    const status = document.getElementById('status');
    let ctx;
    try {
      ctx = await window.appInit.ready(document.body.dataset.page);
      console.debug('[app-init]', { page: document.body.dataset.page, hasAppInit: !!window.appInit, hasFirestorePaths: !!window.firestorePaths, clientId: ctx.clientId, role: ctx.role, pathKeys: Object.keys(ctx.paths || {}) });
    } catch (error) {
      console.error('[internal-users] init failed', error);
      if (status) status.textContent = '初期設定に失敗しました。ログイン状態またはテナント設定を確認してください。';
      return;
    }
    if (!window.isInternalAdmin(window.appContext)) return denyAccess();
    const tbody = document.getElementById('memberRows');
    const tenantInput = document.getElementById('tenantId'); tenantInput.value = window.appContext.tenantId || '';
    async function reload(){ const tenantId=tenantInput.value.trim(); if(!tenantId) throw new Error('TENANT_ID_REQUIRED'); const snap = await window.db.collection('tenants').doc(tenantId).collection('members').get(); tbody.innerHTML = snap.docs.map((d)=>{const x=d.data()||{}; return `<tr><td>${esc(d.id)}</td><td>${esc(x.email)}</td><td>${esc(x.displayName)}</td><td>${esc(x.role)}</td><td>${esc(x.active)}</td></tr>`;}).join(''); }
    document.getElementById('reload').addEventListener('click', async()=>{ try{await reload(); status.textContent='再読込しました';}catch(e){status.textContent=e.message;} });
    document.getElementById('save').addEventListener('click', async()=>{ try{ const payload={ uid:document.getElementById('uid').value.trim(), tenantId:tenantInput.value.trim(), email:document.getElementById('email').value.trim()||null, displayName:document.getElementById('displayName').value.trim()||'', role:document.getElementById('role').value, active:document.getElementById('active').checked}; validateUserPayload(payload); const now=window.firebase.firestore.FieldValue.serverTimestamp(); const utRef=window.db.collection('userTenants').doc(payload.uid); const memberRef=window.db.collection('tenants').doc(payload.tenantId).collection('members').doc(payload.uid); const utSnap=await utRef.get(); const mSnap=await memberRef.get(); const utData={tenantId:payload.tenantId,role:payload.role,active:payload.active,email:payload.email,displayName:payload.displayName,updatedAt:now}; const mData={uid:payload.uid,tenantId:payload.tenantId,role:payload.role,active:payload.active,email:payload.email,displayName:payload.displayName,updatedAt:now}; if(!utSnap.exists) utData.createdAt=now; if(!mSnap.exists) mData.createdAt=now; await Promise.all([utRef.set(utData,{merge:true}),memberRef.set(mData,{merge:true})]); status.textContent='保存しました'; await reload(); }catch(e){ status.textContent=`保存失敗: ${e.message}`; } });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
