(function(){
  window.requireLogin = async function requireLogin(){
    const user = await window.authApi.waitForAuthUser();
    if(!user){
      location.href = './login.html';
      throw new Error('AUTH_REQUIRED');
    }
    return user;
  };
})();
