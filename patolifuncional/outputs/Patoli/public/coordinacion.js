import { $,api,init,config,el,button,badge,formatDate,formatHours,message,busy,showDialog,wireDialogs } from './common.js';
const user = await init({ required:true,role:'admin' });
wireDialogs();
let data = { students:[],entries:[],events:[] };
let reviewTarget = null;
let studentTarget = null;
let editEvent = null;
let archiveTarget = null;
function renderEntries() {
  const filter = $('#review-filter').value;
  const query = $('#review-search').value.toLocaleLowerCase('es');
  const rows = data.entries.filter(row=>(filter === 'all' || row.status === filter) && `${row.name} ${row.email} ${row.university} ${row.activity}`.toLocaleLowerCase('es').includes(query));
  const tbody = $('#review-body'); tbody.replaceChildren();
  $('#review-count').textContent = `${rows.length} ${rows.length === 1 ? 'jornada' : 'jornadas'}`;
  if (!rows.length) {
    const td = el('td',data.entries.length ? 'No hay jornadas que coincidan con estos filtros.' : 'Las jornadas que envíen los estudiantes aparecerán aquí.','empty-state'); td.colSpan = 6;
    const tr = el('tr'); tr.append(td); tbody.append(tr);
  }
  for (const row of rows) {
    const tr = el('tr'); const student = el('td'); student.append(el('strong',row.name),el('small',row.university,'muted'));
    const activity = el('td',row.activity);
    if (row.review_note) activity.append(el('p',row.review_note,'review-note'));
    const status = el('td'); status.append(badge(row.status));
    if (row.reviewer_name) status.append(el('small',`Por ${row.reviewer_name}`,'muted'));
    const actions = el('td',null,'actions');
    if (row.status === 'pending') actions.append(button('Revisar',()=>{
      reviewTarget = row; $('#review-description').textContent = `${row.name} · ${formatDate(row.date)} · ${formatHours(row.minutes/60)} h`;
      $('#review-activity').textContent = row.activity; $('#review-form').reset();
      $('#review-form').note.required = false; $('#review-note-label').textContent = 'Comentario (opcional al aprobar)';
      message('#review-message'); showDialog($('#review-dialog'));
    },'button small'));
    else actions.append(el('small','Finalizada','muted'));
    tr.append(student,el('td',formatDate(row.date)),activity,el('td',`${formatHours(row.minutes/60)} h`),status,actions); tbody.append(tr);
  }
}
function renderStudents() {
  const query = $('#student-search').value.toLocaleLowerCase('es');
  const tbody = $('#students-body'); tbody.replaceChildren();
  const students = data.students.filter(s=>`${s.name} ${s.email} ${s.university}`.toLocaleLowerCase('es').includes(query));
  if (!students.length) {
    const tr = el('tr'); const td = el('td','No hay estudiantes para mostrar. Cada estudiante puede crear su cuenta desde «Crear cuenta».','empty-state'); td.colSpan = 4; tr.append(td); tbody.append(tr);
  }
  for (const student of students) {
    const tr = el('tr'); const name = el('td'); name.append(el('strong',student.name),el('small',student.email,'muted'));
    const institution = el('td'); institution.append(el('span',student.university),el('small',student.student_number || 'Sin matrícula','muted'));
    const progress = el('td'); progress.append(el('strong',`${formatHours(student.approved_hours)} / ${formatHours(student.goal_minutes/60)} h`),el('small',`${formatHours(student.pending_hours)} h en revisión`,'muted'));
    const actions = el('td',null,'actions');
    actions.append(button('Ajustar meta',()=>{
      studentTarget = student; $('#goal-student').textContent = student.name; $('#goal-form').hours.value = student.goal_minutes/60;
      message('#goal-message'); showDialog($('#goal-dialog'));
    }));
    actions.append(button('Restablecer acceso',()=>{
      studentTarget = student; $('#reset-student').textContent = student.name; $('#reset-form').reset();
      message('#reset-message'); showDialog($('#reset-dialog'));
    },'button subtle small'));
    tr.append(name,institution,progress,actions); tbody.append(tr);
  }
}
function renderEvents() {
  const list = $('#admin-events'); list.replaceChildren();
  const events = data.events.filter(event=>!event.archived);
  if (!events.length) list.append(el('p','Aún no hay actividades. Publica la primera en el formulario.','empty-state'));
  for (const event of events) {
    const card = el('article',null,'event-admin');
    card.append(el('h3',event.title),el('p',`${formatDate(event.date)} · ${event.time} h · ${event.location}`,'muted'),el('p',event.description));
    const actions = el('div',null,'actions');
    actions.append(button('Editar',()=>{
      editEvent = event; const form = $('#event-form');
      for (const key of ['title','date','time','location','description']) form.elements[key].value = event[key];
      $('#event-submit').textContent = 'Guardar cambios'; $('#cancel-event-edit').hidden = false; form.elements.title.focus(); form.scrollIntoView({ behavior:'smooth',block:'center' });
    }));
    actions.append(button('Archivar',()=>{
      archiveTarget = event; $('#archive-description').textContent = `«${event.title}» dejará de mostrarse en la agenda.`;
      message('#archive-message'); showDialog($('#archive-dialog'));
    },'button subtle small')); card.append(actions); list.append(card);
  }
}
async function refresh() {
  data = await api('/api/admin/overview');
  $('#admin-name').textContent = user.name;
  $('#pending-count').textContent = data.entries.filter(e=>e.status === 'pending').length;
  $('#student-count').textContent = data.students.length;
  $('#approved-total').textContent = `${formatHours(data.students.reduce((sum,s)=>sum+s.approved_hours,0))} h`;
  renderEntries(); renderStudents(); renderEvents();
}
for (const id of ['review-filter','review-search']) $( '#' + id).addEventListener('input',renderEntries);
$('#student-search').addEventListener('input',renderStudents);
$('#refresh-admin').addEventListener('click',async()=>{
  try { await refresh(); message('#page-message','Información actualizada.'); } catch (error) { message('#page-message',error.message,true); }
});
document.querySelectorAll('[data-panel]').forEach(tab=>tab.addEventListener('click',()=>{
  document.querySelectorAll('[data-panel]').forEach(t=>{ t.setAttribute('aria-selected',String(t === tab)); });
  document.querySelectorAll('.admin-panel').forEach(panel=>panel.hidden=panel.id !== tab.dataset.panel);
}));
$('#review-form').decision.addEventListener('change',event=>{
  const reject = event.target.value === 'rejected'; $('#review-form').note.required = reject; $('#review-form').note.minLength = reject ? 3 : 0;
  $('#review-note-label').textContent = reject ? 'Motivo de devolución (obligatorio)' : 'Comentario (opcional al aprobar)';
});
$('#review-form').addEventListener('submit',async event=>{
  event.preventDefault(); const form = event.currentTarget;
  const body = { status:form.decision.value,note:form.note.value,version:reviewTarget.version };
  await busy(form,async()=>{
    try {
      await api(`/api/admin/entries/${reviewTarget.id}/review`,{ method:'POST',body });
      $('#review-dialog').close(); await refresh();
      message('#page-message',body.status === 'approved' ? 'Horas aprobadas. Ya se sumaron al avance del estudiante.' : 'Jornada devuelta. El estudiante verá tu comentario y podrá corregirla.');
    } catch (error) { message('#review-message',error.message,true); }
  });
});
$('#goal-form').addEventListener('submit',async event=>{
  event.preventDefault(); const form = event.currentTarget; const hours = Number(form.hours.value);
  await busy(form,async()=>{
    try { await api(`/api/admin/users/${studentTarget.id}/goal`,{ method:'PUT',body:{ hours } }); $('#goal-dialog').close(); await refresh(); message('#page-message','La meta del estudiante se actualizó.'); }
    catch (error) { message('#goal-message',error.message,true); }
  });
});
$('#reset-form').addEventListener('submit',async event=>{
  event.preventDefault(); const form = event.currentTarget;
  if (form.password.value !== form.confirm_password.value) return message('#reset-message','Las contraseñas no coinciden.',true);
  const password = form.password.value;
  await busy(form,async()=>{
    try { await api(`/api/admin/users/${studentTarget.id}/password`,{ method:'PUT',body:{ password } }); form.reset(); $('#reset-dialog').close(); message('#page-message','Contraseña temporal guardada. Compártela personalmente con el estudiante; deberá cambiarla al ingresar.'); }
    catch (error) { message('#reset-message',error.message,true); }
  });
});
function resetEvent() { editEvent = null; $('#event-form').reset(); $('#event-submit').textContent = 'Publicar actividad'; $('#cancel-event-edit').hidden = true; }
$('#cancel-event-edit').addEventListener('click',resetEvent);
$('#event-form').addEventListener('submit',async event=>{
  event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form));
  await busy(form,async()=>{
    try { await api(editEvent ? `/api/admin/events/${editEvent.id}` : '/api/admin/events',{ method:editEvent ? 'PUT' : 'POST',body }); resetEvent(); await refresh(); message('#event-message','Actividad guardada en la agenda.'); }
    catch (error) { message('#event-message',error.message,true); }
  });
});
$('#confirm-archive').addEventListener('click',async()=>{
  await busy($('#archive-dialog'),async()=>{
    try { await api(`/api/admin/events/${archiveTarget.id}`,{ method:'DELETE' }); $('#archive-dialog').close(); await refresh(); }
    catch (error) { message('#archive-message',error.message,true); }
  });
});
if (user) {
  try { const settings = await config(); $('#event-form').date.value = settings.today; await refresh(); $('#admin-content').hidden = false; }
  catch (error) { message('#page-message',error.message,true); }
}
