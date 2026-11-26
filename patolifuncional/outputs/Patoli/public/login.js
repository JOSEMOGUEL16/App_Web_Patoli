import { $,api,config,init,setSession,message,busy } from './common.js';
const mode = document.body.dataset.mode;
const form = $('#auth-form');
const setupToken = location.hash.slice(1);
if (mode === 'setup') history.replaceState(null,'',location.pathname);
const user = await init();
if (user) location.replace(user.role === 'admin' ? 'coordinacion.html' : 'status.html');
try {
  const settings = await config();
  if (mode === 'setup' && !settings.setupRequired) {
    form.hidden = true; message('#auth-message','La coordinación ya está configurada. Inicia sesión con tu cuenta.');
  } else if (settings.setupRequired && mode !== 'setup') {
    form.hidden = true; message('#auth-message','Falta crear la cuenta de coordinación. Abre INICIAR-PATOLI para comenzar la configuración inicial.');
  } else if (mode === 'setup' && !setupToken) {
    form.hidden = true; message('#auth-message','Abre INICIAR-PATOLI desde la carpeta de la aplicación. El acceso de configuración se abrirá automáticamente.');
  }
} catch (error) { message('#auth-message',error.message,true); }
if (new URLSearchParams(location.search).has('sesion')) message('#auth-message','Tu sesión terminó. Inicia sesión de nuevo.');
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (mode !== 'login' && data.password !== data.confirm_password) return message('#auth-message','Las contraseñas no coinciden.',true);
  if (mode === 'setup') data.token = setupToken;
  await busy(form,async()=>{
    try {
      const result = await api(`/api/${mode === 'setup' ? 'setup' : mode === 'register' ? 'register' : 'login'}`,{ method:'POST',body:data });
      setSession(result);
      location.assign(result.user.must_change_password ? 'perfil.html' : result.user.role === 'admin' ? 'coordinacion.html' : 'status.html');
    } catch (error) { message('#auth-message',error.message,true); }
  });
});
