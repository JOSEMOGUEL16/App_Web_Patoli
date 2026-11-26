import { $,api,init,config,el,formatDate,message } from './common.js';
const user = await init();
const call = $('#account-link');
if (user) { call.textContent = user.role === 'admin' ? 'Ir a coordinación ↗' : 'Consultar mi avance ↗'; call.href = user.role === 'admin' ? 'coordinacion.html' : 'status.html'; }
try {
  const { events } = await api('/api/events');
  const list = $('#events'); list.replaceChildren();
  if (!events.length) list.append(el('p','Todavía no hay actividades programadas. La coordinación publicará aquí los próximos encuentros.','empty-state'));
  for (const event of events) {
    const article = el('article',null,'evento');
    const time = el('time',null,'fecha'); time.dateTime = event.date;
    time.append(el('span',event.date.slice(8),'fecha-dia'),el('span',formatDate(event.date).slice(3)));
    const info = el('div',null,'evento-info'); info.append(el('h3',event.title),el('p',event.description));
    const place = el('p',`${event.time} h · ${event.location}`,'evento-lugar');
    article.append(time,info,place); list.append(article);
  }
  if ((await config()).setupRequired) {
    $('#welcome-note').hidden = false;
    $('#welcome-note').textContent = 'Bienvenido a Patoli. Abre INICIAR-PATOLI desde la carpeta de la aplicación para crear la cuenta de coordinación.';
  }
} catch (error) { message('#page-message',error.message,true); }
