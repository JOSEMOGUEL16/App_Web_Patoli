import { $,api,init,setSession,message,busy } from './common.js';
const user = await init({ required:true });
const form = $('#profile-form');
function render(user) {
  $('#profile-name').textContent = user.name;
  $('#initials').textContent = user.name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  $('#profile-role').textContent = user.role === 'admin' ? 'Coordinación' : 'Servicio social';
  $('#profile-email').textContent = user.email;
  for (const field of ['name','university','degree','student_number']) form.elements[field].value = user[field];
  $('#student-fields').hidden = user.role === 'admin'; form.university.required = user.role === 'student';
  if (user.must_change_password) { $('#password-alert').hidden = false; form.querySelector('button').disabled = true; }
}
if (user) { render(user); $('#profile-content').hidden = false; }
form.addEventListener('submit',async event=>{
  event.preventDefault(); const body = Object.fromEntries(new FormData(form));
  await busy(form,async()=>{
    try { const result = await api('/api/profile',{ method:'PUT',body }); setSession(result); render(result.user); message('#profile-message','Tu perfil se guardó.'); }
    catch (error) { message('#profile-message',error.message,true); }
  });
});
$('#password-form').addEventListener('submit',async event=>{
  event.preventDefault(); const passwordForm = event.currentTarget;
  const body = Object.fromEntries(new FormData(passwordForm));
  if (body.password !== body.confirm_password) return message('#password-message','Las contraseñas no coinciden.',true);
  await busy(passwordForm,async()=>{
    try {
      const result = await api('/api/password',{ method:'PUT',body }); setSession(result); passwordForm.reset();
      $('#password-alert').hidden = true; form.querySelector('button').disabled = false;
      message('#password-message','Contraseña actualizada. Se cerraron las demás sesiones de tu cuenta.');
    } catch (error) { message('#password-message',error.message,true); }
  });
});
