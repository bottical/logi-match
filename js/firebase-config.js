// Firebase config is centralized here for easy environment replacement.
// IMPORTANT: Replace all YOUR_* placeholders with values from your real Firebase project.
// NOTE: Firebase config is not a secret key; protect data with strict Firestore Security Rules in production.
window.firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_APP_ID'
};

(function initFirebase() {
  if (!window.firebase) {
    console.error('[firebase] Firebase SDK is not loaded.');
    return;
  }

  if (!window.firebase.apps.length) {
    window.firebase.initializeApp(window.firebaseConfig);
  }

  window.db = window.firebase.firestore();
  window.auth = window.firebase.auth ? window.firebase.auth() : null;

  console.info('[firebase] initialized');
})();
