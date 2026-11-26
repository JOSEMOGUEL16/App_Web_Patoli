import { createApp,today } from '../outputs/Patoli/server.mjs';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const dir = await mkdtemp(resolve('work/ui-preview-'));
const app = createApp({ dbPath:resolve(dir,'preview.sqlite'),setupToken:'patoli-ui-setup-only' });
const { url } = await app.listen(3100);
const admin = {}, student = {};
async function send(client,path,body) {
  const response = await fetch(url+path,{ method:'POST',headers:{ Origin:url,'Content-Type':'application/json',...(client.cookie ? { Cookie:client.cookie,'X-CSRF-Token':client.csrf } : {}) },body:JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  if (response.headers.get('set-cookie')) client.cookie = response.headers.get('set-cookie').split(';')[0];
  if (data.csrf) client.csrf = data.csrf;
  return data;
}
await send(admin,'/api/setup',{ token:'patoli-ui-setup-only',name:'Coordinación de prueba',email:'admin@patoli.test',password:'Patoli-prueba-2026!' });
await send(student,'/api/register',{ name:'Ana de prueba',email:'ana@patoli.test',university:'BUAP',degree:'Ingeniería',password:'Patoli-prueba-2026!' });
await send(student,'/api/entries',{ date:today(),activity:'Preparación de materiales para el taller comunitario',hours:3.5,client_id:randomUUID() });
await send(admin,'/api/admin/events',{ title:'Taller comunitario',date:today(),time:'10:00',location:'Sala de talleres',description:'Una mañana para compartir conocimientos y aprender juntos. Actividad de prueba.' });
console.log('Vista de prueba disponible: ' + url);
console.log('Base de prueba: ' + dir);
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{ await app.close(); process.exit(0); });
