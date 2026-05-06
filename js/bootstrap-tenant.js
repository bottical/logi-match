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

    const userTenantRef = window.db.collection('userTenants').doc(user.uid);
    const userTenantSnap = await userTenantRef.get();
    if (userTenantSnap.exists) return { created: false, tenantId: userTenantSnap.data()?.tenantId || null };

    const loginEmail = normalizeEmail(user.email);
    if (!loginEmail) throw new Error('BOOTSTRAP_EMAIL_MISMATCH');

    const allowRef = window.db.collection('allowedBootstrapUsers').doc(user.uid);

    return window.db.runTransaction(async (tx) => {
      const allowSnap = await tx.get(allowRef);
      if (!allowSnap.exists) throw new Error('USER_NOT_REGISTERED');

      const allowData = allowSnap.data() || {};
      if (allowData.status !== 'pending') throw new Error('BOOTSTRAP_NOT_AVAILABLE');

      const adminEmail = normalizeEmail(allowData.adminEmail);
      if (!adminEmail || adminEmail !== loginEmail) throw new Error('BOOTSTRAP_EMAIL_MISMATCH');

      const clientId = String(allowData.clientId || '').trim();
      if (!clientId) throw new Error('CLIENT_ID_MISSING');
      const clientName = String(allowData.clientName || '').trim() || '初期クライアント';
      const now = nowField();

      const tenantRef = window.db.collection('tenants').doc(clientId);
      const memberRef = tenantRef.collection('members').doc(user.uid);
      const clientRef = window.db.collection('clients').doc(clientId);
      const globalUserRef = window.db.collection('users').doc(user.uid);
      const clientUserRef = clientRef.collection('users').doc(user.uid);
      const workerRef = clientRef.collection('workers').doc('worker-001');
      const csvMappingRef = clientRef.collection('csvMapping').doc('current');

      const [
        clientSnap,
        tenantSnap,
        globalUserSnap,
        clientUserSnap,
        workerSnap,
        csvMappingSnap,
        userTenantInTxSnap,
        memberSnap
      ] = await Promise.all([
        tx.get(clientRef),
        tx.get(tenantRef),
        tx.get(globalUserRef),
        tx.get(clientUserRef),
        tx.get(workerRef),
        tx.get(csvMappingRef),
        tx.get(userTenantRef),
        tx.get(memberRef)
      ]);

      if (clientSnap.exists && (clientSnap.data()?.isActive === false || clientSnap.data()?.active === false)) {
        throw new Error('CLIENT_INACTIVE');
      }
      if (tenantSnap.exists && (tenantSnap.data()?.status === 'inactive' || tenantSnap.data()?.isActive === false || tenantSnap.data()?.active === false)) {
        throw new Error('CLIENT_INACTIVE');
      }
      if (globalUserSnap.exists) {
        throw new Error('USER_ALREADY_EXISTS');
      }
      if (userTenantInTxSnap.exists) {
        return { created: false, tenantId: userTenantInTxSnap.data()?.tenantId || clientId };
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

      tx.set(globalUserRef, {
        uid: user.uid,
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

      if (!clientUserSnap.exists) {
        tx.set(clientUserRef, {
          uid: user.uid,
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
          updatedBy: user.uid
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
          bootstrapByUid: user.uid,
          bootstrapByEmail: user.email || null
        });
      }

      if (!memberSnap.exists) {
        tx.set(memberRef, {
          uid: user.uid,
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

      tx.update(allowRef, {
        status: 'used',
        usedAt: now,
        usedByUid: user.uid,
        updatedAt: now
      });

      return { created: true, tenantId: clientId };
    });
  };
})();
