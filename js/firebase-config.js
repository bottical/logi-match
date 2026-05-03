// Firebase config is centralized here for easy environment replacement.
// IMPORTANT: Replace all YOUR_* placeholders with values from your real Firebase project.
// NOTE: Firebase config is not a secret key; protect data with strict Firestore Security Rules in production.
window.firebaseConfig = {
    apiKey: "AIzaSyCbRTnvbIgFTKzVWYClRzULmAxjj1-KtpE",
    authDomain: "logi-match.firebaseapp.com",
    projectId: "logi-match",
    storageBucket: "logi-match.firebasestorage.app",
    messagingSenderId: "406394358655",
    appId: "1:406394358655:web:e51e7768b3def9c74ba84a"
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
