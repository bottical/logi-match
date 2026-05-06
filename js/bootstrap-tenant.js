(function () {
  function nowField() {
    return window.firebase.firestore.FieldValue.serverTimestamp();
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  window.bootstrapTenantIfNeeded = async function bootstrapTenantIfNeeded(user) {
    if (!window.db || !window.firebase?.firestore) throw new Error('Firestore is not initialized.');
    if (!user?.uid) throw new Error('AUTH_USER_MISSING');

    const loginEmail = normalizeEmail(user.email);
    if (!loginEmail) throw new Error('BOOTSTRAP_EMAIL_MISMATCH');

    const uid = user.uid;
    const clientId = `client_${uid}`;
    const clientName = user.displayName || user.email || '初期クライアント';
    const userTenantRef = window.db.collection('userTenants').doc(uid);

    return window.db.runTransaction(async (tx) => {
      const userTenantSnap = await tx.get(userTenantRef);
      if (userTenantSnap.exists) {
        return { created: false, tenantId: userTenantSnap.data()?.tenantId || null };
      }

      const now = nowField();
      const tenantRef = window.db.collection('tenants').doc(clientId);
      const memberRef = tenantRef.collection('members').doc(uid);
      const clientRef = window.db.collection('clients').doc(clientId);
      const globalUserRef = window.db.collection('users').doc(uid);
      const clientUserRef = clientRef.collection('users').doc(uid);
      const workerRef = clientRef.collection('workers').doc('worker-001');
      const csvMappingRef = clientRef.collection('csvMapping').doc('current');

      const [
        clientSnap,
        tenantSnap,
        globalUserSnap,
        clientUserSnap,
        workerSnap,
        csvMappingSnap,
        memberSnap
      ] = await Promise.all([
        tx.get(clientRef),
        tx.get(tenantRef),
        tx.get(globalUserRef),
        tx.get(clientUserRef),
        tx.get(workerRef),
        tx.get(csvMappingRef),
        tx.get(memberRef)
      ]);

      if (globalUserSnap.exists) {
        const existing = globalUserSnap.data() || {};
        if (existing.clientId && existing.clientId !== clientId) {
          throw new Error('USER_ALREADY_EXISTS');
        }
      }

      if (!clientSnap.exists) {
        tx.set(clientRef, {
          clientId,
          clientName,
          isActive: true,
          active: true,
          createdAt: now,
          updatedAt: now
        });
      }

      if (!tenantSnap.exists) {
        tx.set(tenantRef, {
          name: clientName,
          clientId,
          clientName,
          status: 'active',
          active: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          bootstrap: true,
          bootstrapByUid: uid,
          bootstrapByEmail: user.email || null
        });
      }

      if (!globalUserSnap.exists) {
        tx.set(globalUserRef, {
          uid,
          clientId,
          email: user.email || null,
          emailLower: loginEmail,
          displayName: user.displayName || user.email || '',
          role: 'admin',
          isActive: true,
          active: true,
          createdAt: now,
          updatedAt: now
        });
      }

      if (!clientUserSnap.exists) {
        tx.set(clientUserRef, {
          uid,
          clientId,
          email: user.email || null,
          emailLower: loginEmail,
          displayName: user.displayName || user.email || '',
          role: 'admin',
          isActive: true,
          active: true,
          createdAt: now,
          updatedAt: now
        });
      }

      if (!workerSnap.exists) {
        tx.set(workerRef, {
          workerId: 'worker-001',
          workerName: '作業者1',
          isActive: true,
          active: true,
          sortOrder: 1,
          createdAt: now,
          updatedAt: now
        });
      }

      if (!csvMappingSnap.exists) {
        tx.set(csvMappingRef, {
          hasHeader: true,
          columns: {
            pickingNo: 'ピッキングNo',
            jan: 'JAN',
            alternativeCode: '代替コード',
            productName: '商品名',
            quantity: '数量',
            destinationName: 'お届け先名',
            slipNo: '伝票番号',
            shipDate: '出荷日',
            shipperName: '荷主名',
            location: 'ロケーション'
          },
          updatedAt: now,
          updatedBy: uid
        });
      }

      tx.set(userTenantRef, {
        tenantId: clientId,
        role: 'owner',
        active: true,
        email: user.email || null,
        displayName: user.displayName || user.email || '',
        createdAt: now,
        updatedAt: now
      });

      if (!memberSnap.exists) {
        tx.set(memberRef, {
          uid,
          tenantId: clientId,
          role: 'owner',
          active: true,
          email: user.email || null,
          displayName: user.displayName || user.email || '',
          createdAt: now,
          updatedAt: now,
          bootstrap: true
        });
      }

      return { created: true, tenantId: clientId };
    });
  };
})();
