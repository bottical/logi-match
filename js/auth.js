(function(){
  window.authApi = {
    loginWithEmail(email,password){ return window.auth.signInWithEmailAndPassword(email,password); },
    logout(){ return window.auth.signOut(); },
    waitForAuthUser(){
      return new Promise((resolve)=>{
        const unsub = window.auth.onAuthStateChanged((user)=>{ unsub(); resolve(user||null); });
      });
    }
  };
})();
