(function(){
  const VALID_ROLES = ['admin', 'worker'];
  const esc = (v)=>String(v ?? '').replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

  function denyAccess() { const panel = document.querySelector('.panel'); if (panel) panel.innerHTML = '<h2>権限がありません</h2>'; }

  async function init(){
    const status = document.getElementById('status');
    let ctx;
    try { ctx = await window.appInit.ready(document.body.dataset.page); }
    catch (error) { status.textContent = '初期設定に失敗しました。'; return; }
    if (!window.permissions?.isSystemOwner(ctx)) return denyAccess();

    const tbody = document.getElementById('memberRows');
    const clientIdInput = document.getElementById('clientId');
    clientIdInput.value = '';

    async function reload(){
      const clientId = clientIdInput.value.trim(); if(!clientId) throw new Error('CLIENT_ID_REQUIRED');
      const snap = await window.db.collection('clients').doc(clientId).collection('users').get();
      tbody.innerHTML = snap.docs.map((d)=>{const x=d.data()||{}; return `<tr><td>${esc(d.id)}</td><td>${esc(x.email)}</td><td>${esc(x.displayName)}</td><td>${esc(x.role)}</td><td>${esc(x.isActive)}</td><td>${esc(x.updatedAt?.toDate?.()?.toLocaleString?.()||'')}</td></tr>`;}).join('');
    }

    document.getElementById('reload').addEventListener('click', async()=>{ try{await reload(); status.textContent='再読込しました';}catch(e){status.textContent=e.message;} });
    document.getElementById('save').addEventListener('click', async()=>{
      try{
        const clientId=clientIdInput.value.trim(); const clientName=document.getElementById('clientName').value.trim();
        const clientStatus=document.getElementById('clientStatus').value;
        const uid=document.getElementById('uid').value.trim(); const email=document.getElementById('email').value.trim();
        const displayName=document.getElementById('displayName').value.trim()||''; const role=document.getElementById('role').value;
        const active=document.getElementById('active').checked;
        if(!clientId) throw new Error('CLIENT_ID_REQUIRED'); if(!uid) throw new Error('UID_REQUIRED'); if(!email) throw new Error('EMAIL_REQUIRED');
        if(!VALID_ROLES.includes(role)) throw new Error('INVALID_ROLE');
        const now=window.firebase.firestore.FieldValue.serverTimestamp();
        const clientRef = window.db.collection('clients').doc(clientId);
        const userTenantRef = window.db.collection('userTenants').doc(uid);
        const clientUserRef = clientRef.collection('users').doc(uid);
        const [clientSnap, userTenantSnap, clientUserSnap] = await Promise.all([clientRef.get(), userTenantRef.get(), clientUserRef.get()]);
        const clientData = { clientId, clientName, status: clientStatus || 'active', updatedAt: now };
        if (!clientSnap.exists) clientData.createdAt = now;
        const userTenantData = { uid, clientId, tenantId: clientId, active, updatedAt: now };
        if (!userTenantSnap.exists) userTenantData.createdAt = now;
        const clientUserData = { uid, clientId, email, displayName, role, isActive: active, updatedAt: now };
        if (!clientUserSnap.exists) clientUserData.createdAt = now;
        await Promise.all([
          clientRef.set(clientData, { merge: true }),
          userTenantRef.set(userTenantData, { merge: true }),
          clientUserRef.set(clientUserData, { merge: true }),
        ]);
        status.textContent='保存しました'; await reload();
      }catch(e){ status.textContent=`保存失敗: ${e.message}`; }
    });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
