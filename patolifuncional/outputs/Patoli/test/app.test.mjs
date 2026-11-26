import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp,today } from '../server.mjs';

test('Patoli: flujo real de servicio social, permisos y persistencia',async t=>{
  const dir = await mkdtemp(join(tmpdir(),'patoli-test-'));
  const dbPath = join(dir,'test.sqlite');
  let app = createApp({ dbPath,setupToken:'initial-test-token' });
  let { url } = await app.listen(0);
  const admin = {}, ana = {}, bea = {}, anonymous = {};
  const password = 'Una-frase-de-prueba-2026';
  let first, second;
  async function request(client,path,{ method='GET',body,headers={},expect=200 }={}) {
    const res = await fetch(url+path,{ method,headers:{ Origin:url,...(client.cookie ? { Cookie:client.cookie } : {}),...(client.csrf ? { 'X-CSRF-Token':client.csrf } : {}),...(body !== undefined ? { 'Content-Type':'application/json' } : {}),...headers },...(body !== undefined ? { body:JSON.stringify(body) } : {}) });
    const content = res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text();
    assert.equal(res.status,expect,`${method} ${path}: ${JSON.stringify(content)}`);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) client.cookie = setCookie.split(';')[0];
    if (content.csrf) client.csrf = content.csrf;
    if (content.user) client.user = content.user;
    return content;
  }
  const submit = (client,extra={})=>request(client,'/api/entries',{ method:'POST',expect:201,body:{ date:today(),activity:'Apoyo en taller comunitario',hours:4.5,client_id:randomUUID(),...extra } });
  try {
    await t.test('inicio protegido y cuenta de coordinación única',async()=>{
      assert.equal((await request(anonymous,'/api/config')).setupRequired,true);
      await request(anonymous,'/api/setup',{ method:'POST',body:{ token:'wrong' },expect:403 });
      await request(anonymous,'/api/register',{ method:'POST',body:{},expect:409 });
      await request(admin,'/api/setup',{ method:'POST',expect:201,body:{ token:'initial-test-token',name:'Coordinación Patoli',email:'coord@example.test',password } });
      assert.equal(admin.user.role,'admin');
      await request(anonymous,'/api/setup',{ method:'POST',body:{},expect:409 });
      assert.equal((await request(anonymous,'/api/config')).setupRequired,false);
    });
    await t.test('registro, correo único e imposibilidad de elevar privilegios',async()=>{
      const profile = { name:'Ana Estudiante',email:'ANA@example.test',password,university:'BUAP',degree:'Ingeniería',student_number:'2026001',role:'admin',goal_minutes:1 };
      await request(ana,'/api/register',{ method:'POST',body:profile,expect:201 });
      assert.equal(ana.user.role,'student'); assert.equal(ana.user.goal_minutes,28800);
      await request(anonymous,'/api/register',{ method:'POST',body:{ ...profile,email:'ana@example.test' },expect:409 });
      await request(bea,'/api/register',{ method:'POST',expect:201,body:{ ...profile,name:'Bea Estudiante',email:'bea@example.test' } });
      await request(anonymous,'/api/login',{ method:'POST',body:{ email:'ana@example.test',password:'incorrecta' },expect:401 });
    });
    await t.test('sesión, origen, CSRF y rol exigidos por el servidor',async()=>{
      await request(anonymous,'/api/entries',{ expect:401 });
      await request(ana,'/api/admin/overview',{ expect:403 });
      await request(ana,'/api/admin/report.csv',{ expect:403 });
      await request(admin,'/api/entries',{ method:'POST',body:{},expect:403 });
      await request(ana,'/api/profile',{ method:'PUT',body:{},headers:{ Origin:'https://otro.example' },expect:403 });
      await request(ana,'/api/profile',{ method:'PUT',body:{},headers:{ 'X-CSRF-Token':'incorrecto' },expect:403 });
      for (const path of ['/server.mjs','/database.mjs','/data/patoli.sqlite','/.git/config','/scripts/respaldo.mjs']) await request(anonymous,path,{ expect:404 });
    });
    await t.test('jornada enviada a revisión sin sumar horas al avance',async()=>{
      first = (await submit(ana)).entry;
      assert.equal(first.status,'pending');
      const result = await request(ana,'/api/entries');
      assert.equal(result.totals.approved,0); assert.equal(result.totals.pending,4.5);
      assert.equal(result.remaining,480);
      assert.equal((await request(bea,'/api/entries')).entries.length,0);
      await request(bea,`/api/entries/${first.id}`,{ method:'PUT',body:{ version:first.version },expect:404 });
      await request(bea,`/api/entries/${first.id}`,{ method:'DELETE',body:{ version:first.version },expect:404 });
      await request(ana,`/api/admin/entries/${first.id}/review`,{ method:'POST',body:{ status:'approved',version:first.version },expect:403 });
    });
    await t.test('reintento seguro, duplicados y validación de fecha y horas',async()=>{
      const retried = await request(ana,'/api/entries',{ method:'POST',body:{ client_id:first.client_id } });
      assert.equal(retried.entry.id,first.id);
      await request(ana,'/api/entries',{ method:'POST',expect:409,body:{ client_id:randomUUID(),date:today(),activity:first.activity,hours:4.5 } });
      for (const extra of [{ hours:-1 },{ hours:0 },{ hours:25 },{ hours:1.1 },{ hours:'4' },{ date:'2099-01-01' },{ date:'2026-02-30' },{ activity:'x' }]) {
        await request(ana,'/api/entries',{ method:'POST',expect:400,body:{ client_id:randomUUID(),date:today(),activity:'Otra actividad válida',hours:1,...extra } });
      }
      await request(ana,'/api/entries',{ method:'POST',expect:400,body:{ client_id:randomUUID(),date:today(),activity:'Demasiadas horas',hours:20 } });
    });
    await t.test('devolución con comentario y corrección para reenviar',async()=>{
      await request(admin,`/api/admin/entries/${first.id}/review`,{ method:'POST',expect:400,body:{ status:'rejected',note:'',version:first.version } });
      first = (await request(admin,`/api/admin/entries/${first.id}/review`,{ method:'POST',body:{ status:'rejected',note:'Describe las tareas realizadas.',version:first.version } })).entry;
      const rejected = await request(ana,'/api/entries');
      assert.equal(rejected.totals.pending,0); assert.equal(rejected.totals.rejected,4.5);
      assert.equal(rejected.entries[0].review_note,'Describe las tareas realizadas.');
      await request(ana,`/api/entries/${first.id}`,{ method:'PUT',expect:409,body:{ date:today(),activity:'Detalle del taller',hours:4,version:1 } });
      first = (await request(ana,`/api/entries/${first.id}`,{ method:'PUT',body:{ date:today(),activity:'Preparación de materiales y apoyo en taller',hours:4,version:first.version } })).entry;
      assert.equal(first.status,'pending'); assert.equal(first.review_note,'');
    });
    await t.test('aprobación suma solo una vez y bloquea cambios posteriores',async()=>{
      const version = first.version;
      first = (await request(admin,`/api/admin/entries/${first.id}/review`,{ method:'POST',body:{ status:'approved',note:'Actividad verificada.',version } })).entry;
      const result = await request(ana,'/api/entries');
      assert.equal(result.totals.approved,4); assert.equal(result.totals.pending,0); assert.equal(result.remaining,476);
      assert.equal(result.entries[0].reviewer_name,'Coordinación Patoli');
      await request(admin,`/api/admin/entries/${first.id}/review`,{ method:'POST',expect:409,body:{ status:'approved',version } });
      await request(ana,`/api/entries/${first.id}`,{ method:'PUT',expect:409,body:{ version:first.version } });
      await request(ana,`/api/entries/${first.id}`,{ method:'DELETE',expect:409,body:{ version:first.version } });
    });
    await t.test('edición, retiro y conservación de auditoría',async()=>{
      second = (await submit(ana,{ activity:'Organizar materiales',hours:2 })).entry;
      second = (await request(ana,`/api/entries/${second.id}`,{ method:'PUT',body:{ date:today(),activity:'Organizar materiales para el taller',hours:2.5,version:second.version } })).entry;
      await request(ana,`/api/entries/${second.id}`,{ method:'DELETE',body:{ version:second.version } });
      assert.equal((await request(ana,'/api/entries')).entries.length,1);
      assert.equal(app.db.prepare('SELECT status FROM entries WHERE id=?').get(second.id).status,'cancelled');
      const audit = app.db.prepare('SELECT action FROM audit WHERE entry_id=? ORDER BY id').all(first.id).map(a=>a.action);
      assert.deepEqual(audit,['submitted','rejected','resubmitted','approved']);
    });
    await t.test('perfil y metas con control de rol',async()=>{
      await request(ana,'/api/profile',{ method:'PUT',body:{ name:'Ana Actualizada',university:'BUAP',degree:'Computación',student_number:'A123',role:'admin',goal_minutes:1 } });
      const result = await request(ana,'/api/me'); assert.equal(result.user.name,'Ana Actualizada'); assert.equal(result.user.role,'student'); assert.equal(result.user.goal_minutes,28800);
      await request(ana,`/api/admin/users/${ana.user.id}/goal`,{ method:'PUT',body:{ hours:400 },expect:403 });
      await request(admin,`/api/admin/users/${ana.user.id}/goal`,{ method:'PUT',body:{ hours:400 } });
      assert.equal((await request(ana,'/api/me')).remaining,396);
    });
    await t.test('agenda publica solo actividades vigentes y permite editar y archivar',async()=>{
      const event = { title:'Taller de comunidad',date:'2099-01-01',time:'10:00',location:'Patio principal',description:'Organización del taller comunitario.' };
      await request(ana,'/api/admin/events',{ method:'POST',body:event,expect:403 });
      const { id } = await request(admin,'/api/admin/events',{ method:'POST',body:event,expect:201 });
      await request(admin,`/api/admin/events/${id}`,{ method:'PUT',body:{ ...event,title:'Taller actualizado' } });
      assert.equal((await request(anonymous,'/api/events')).events[0].title,'Taller actualizado');
      await request(admin,'/api/admin/events',{ method:'POST',body:{ ...event,date:'2020-01-01' },expect:201 });
      assert.equal((await request(anonymous,'/api/events')).events.length,1);
      await request(admin,`/api/admin/events/${id}`,{ method:'DELETE' });
      assert.equal((await request(anonymous,'/api/events')).events.length,0);
    });
    await t.test('reporte, privacidad de contraseñas y exportación segura',async()=>{
      await submit(bea,{ activity:'=HYPERLINK("https://example.test")',hours:1 });
      const csv = await request(admin,'/api/admin/report.csv');
      assert.ok(csv.includes('Ana Actualizada')); assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes('Aprobado'));
      const rows = app.db.prepare('SELECT password_hash FROM users').all();
      assert.ok(rows.every(row=>row.password_hash.startsWith('scrypt$') && !row.password_hash.includes(password)));
      const overview = await request(admin,'/api/admin/overview'); assert.ok(!JSON.stringify(overview).includes('scrypt$'));
    });
    await t.test('los datos y sesiones sobreviven a un reinicio real',async()=>{
      await app.close(); app = createApp({ dbPath }); ({ url } = await app.listen(0));
      const result = await request(ana,'/api/entries');
      assert.equal(result.totals.approved,4); assert.equal(result.user.name,'Ana Actualizada');
      assert.equal((await request(anonymous,'/api/config')).setupRequired,false);
    });
    await t.test('restablecimiento revoca sesiones y exige cambiar la clave temporal',async()=>{
      const temporary = 'Temporal-privada-2026';
      await request(admin,`/api/admin/users/${bea.user.id}/password`,{ method:'PUT',body:{ password:temporary } });
      await request(bea,'/api/me',{ expect:401 });
      await request(bea,'/api/login',{ method:'POST',body:{ email:'bea@example.test',password:temporary } });
      assert.equal(bea.user.must_change_password,1);
      await request(bea,'/api/entries',{ expect:403 });
      await request(bea,'/api/password',{ method:'PUT',body:{ current_password:temporary,password:'Nueva-frase-privada-2026' } });
      assert.equal(bea.user.must_change_password,0);
      assert.equal((await request(bea,'/api/entries')).entries.length,1);
    });
    await t.test('cambio de contraseña cierra otras sesiones; salir invalida la sesión',async()=>{
      const another = {};
      await request(another,'/api/login',{ method:'POST',body:{ email:'ana@example.test',password } });
      await request(ana,'/api/password',{ method:'PUT',body:{ current_password:password,password:'Otra-frase-privada-2026' } });
      await request(another,'/api/me',{ expect:401 });
      await request(ana,'/api/logout',{ method:'POST' });
      await request(ana,'/api/me',{ expect:401 });
    });
    await t.test('pantallas, imágenes, scripts y políticas del navegador',async()=>{
      for (const path of ['/','/index.html','/home.html','/login.html','/registro.html','/configurar.html','/status.html','/perfil.html','/coordinacion.html','/styles.css','/app.css','/common.js','/status.js','/coordinacion.js','/images/patoli.png','/images/IMG_1520.webp']) {
        const res = await fetch(url+path); assert.equal(res.status,200,path); assert.equal(res.headers.get('x-content-type-options'),'nosniff'); assert.ok(res.headers.get('content-security-policy').includes("frame-ancestors 'none'")); await res.arrayBuffer();
      }
    });
    await t.test('limita intentos repetidos de contraseña',async()=>{
      for (let i=0;i<12;i++) await request(anonymous,'/api/login',{ method:'POST',body:{ email:'nadie@example.test',password:'incorrecta' },expect:401 });
      await request(anonymous,'/api/login',{ method:'POST',body:{ email:'nadie@example.test',password:'incorrecta' },expect:429 });
    });
  } finally { await app.close(); await rm(dir,{ recursive:true,force:true }); }
});
