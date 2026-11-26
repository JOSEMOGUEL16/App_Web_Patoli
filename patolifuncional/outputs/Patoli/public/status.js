import { $,api,init,config,el,button,badge,formatDate,formatHours,message,busy,showDialog,wireDialogs } from './common.js';
const user = await init({ required:true,role:'student' });
wireDialogs();
let entries = [];
let editing = null;
let cancelTarget = null;
let submissionId = crypto.randomUUID();
const form = $('#hours-form');
function render() {
  const filter = $('#history-filter').value;
  const list = entries.filter(entry=>filter === 'all' || entry.status === filter);
  const tbody = $('#hours-body'); tbody.replaceChildren();
  $('#history-count').textContent = `${list.length} ${list.length === 1 ? 'jornada' : 'jornadas'}`;
  if (!list.length) {
    const td = el('td',entries.length ? 'No hay jornadas con este estado.' : 'Aún no has enviado horas. Registra tu primera jornada arriba.','empty-state'); td.colSpan = 5;
    const tr = el('tr'); tr.append(td); tbody.append(tr);
  }
  for (const entry of list) {
    const tr = el('tr');
    const activity = el('td'); activity.append(el('strong',entry.activity));
    if (entry.review_note) activity.append(el('p',`Coordinación: ${entry.review_note}`,'review-note'));
    if (entry.reviewer_name) activity.append(el('small',`Revisó ${entry.reviewer_name}`,'muted'));
    const status = el('td'); status.append(badge(entry.status));
    const actions = el('td',null,'actions');
    if (['pending','rejected'].includes(entry.status)) {
      actions.append(button(entry.status === 'rejected' ? 'Corregir y reenviar' : 'Editar',()=>{
        editing = entry; form.date.value = entry.date; form.hours.value = entry.minutes/60; form.activity.value = entry.activity;
        $('#form-title').textContent = 'Corrige tu jornada.';
        $('#send-hours').textContent = 'Reenviar a revisión'; $('#cancel-edit').hidden = false;
        message('#form-message',entry.review_note ? `Comentario de coordinación: ${entry.review_note}` : 'Los cambios se enviarán nuevamente a revisión.');
        form.scrollIntoView({ behavior:'smooth',block:'center' }); form.activity.focus();
      }));
      actions.append(button('Retirar',()=>{
        cancelTarget = entry; $('#cancel-description').textContent = `Retirarás la jornada «${entry.activity}» del ${formatDate(entry.date)} (${formatHours(entry.minutes/60)} h).`;
        message('#cancel-message'); showDialog($('#cancel-dialog'));
      },'button subtle small'));
    } else actions.append(el('small','Revisión finalizada','muted'));
    tr.append(el('td',formatDate(entry.date)),activity,el('td',`${formatHours(entry.minutes/60)} h`),status,actions); tbody.append(tr);
  }
}
async function refresh() {
  const data = await api('/api/entries'); entries = data.entries;
  $('#student-name').textContent = data.user.name; $('#student-university').textContent = data.user.university;
  $('#approved-hours').textContent = formatHours(data.totals.approved);
  $('#goal-hours').textContent = `/ ${formatHours(data.user.goal_minutes/60)} horas`;
  $('#pending-hours').textContent = `${formatHours(data.totals.pending)} h`;
  $('#rejected-hours').textContent = `${formatHours(data.totals.rejected)} h`;
  $('#remaining-hours').textContent = `${formatHours(data.remaining)} horas`;
  $('#percentage').textContent = `${data.percentage}% completado`;
  $('#progress').max = data.user.goal_minutes; $('#progress').value = Math.min(data.user.goal_minutes,data.totals.approved*60);
  $('#progress').setAttribute('aria-valuetext',`${formatHours(data.totals.approved)} de ${formatHours(data.user.goal_minutes/60)} horas aprobadas`);
  $('#service-state').textContent = data.remaining === 0 ? 'Meta completada' : 'En curso'; render();
}
function resetForm() {
  editing = null; submissionId = crypto.randomUUID(); form.reset(); form.date.value = form.date.max;
  $('#form-title').textContent = 'Registra tu jornada.'; $('#send-hours').textContent = 'Enviar a revisión ↗'; $('#cancel-edit').hidden = true;
}
$('#cancel-edit').addEventListener('click',()=>{ resetForm(); message('#form-message'); });
$('#history-filter').addEventListener('change',render);
$('#refresh-history').addEventListener('click',async()=>{
  try { await refresh(); message('#page-message','Tu avance está actualizado.'); } catch (error) { message('#page-message',error.message,true); }
});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const data = { date:form.date.value,hours:Number(form.hours.value),activity:form.activity.value,client_id:submissionId,...(editing ? { version:editing.version } : {}) };
  await busy(form,async()=>{
    try {
      await api(editing ? `/api/entries/${editing.id}` : '/api/entries',{ method:editing ? 'PUT' : 'POST',body:data });
      resetForm(); message('#form-message','Jornada enviada. Tus horas se sumarán al avance cuando coordinación las apruebe.');
      try { await refresh(); } catch { message('#page-message','Tu jornada se guardó. Pulsa Actualizar para volver a cargar el historial.',true); }
    } catch (error) { message('#form-message',error.message,true); }
  });
});
$('#confirm-cancel').addEventListener('click',async()=>{
  await busy($('#cancel-dialog'),async()=>{
    try {
      await api(`/api/entries/${cancelTarget.id}`,{ method:'DELETE',body:{ version:cancelTarget.version } });
      if (editing?.id === cancelTarget.id) resetForm();
      $('#cancel-dialog').close(); await refresh(); message('#page-message','La jornada fue retirada.');
    } catch (error) { message('#cancel-message',error.message,true); }
  });
});
if (user) {
  try { const settings = await config(); form.date.max = settings.today; form.date.value = settings.today; await refresh(); $('#student-content').hidden = false; }
  catch (error) { message('#page-message',error.message,true); }
}
