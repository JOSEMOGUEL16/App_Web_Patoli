import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { openDatabase, transaction } from './database.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const derive = promisify(scrypt);
const SESSION_MS = 12 * 60 * 60 * 1000;
const publicColumns = 'id,name,email,role,university,degree,student_number,goal_minutes,must_change_password';
const sha = value => createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
function textField(value, label, min = 1, max = 150) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400, `${label}: usa entre ${min} y ${max} caracteres.`);
  return value.trim();
}
function emailField(value) {
  const email = textField(value, 'Correo', 5, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Escribe un correo electrónico válido.');
  return email;
}
function passwordField(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
  return value;
}
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt}$${hash.toString('hex')}`;
}
async function checkPassword(password, encoded) {
  const [, salt, hex] = (encoded || `scrypt$00000000000000000000000000000000$${'0'.repeat(128)}`).split('$');
  const hash = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(hash, Buffer.from(hex, 'hex'));
}
function dateField(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01') fail(400, 'La fecha no es válida.');
  const d = new Date(value + 'T12:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail(400, 'La fecha no es válida.');
  return value;
}
function hoursField(value, max = 24) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max || !Number.isInteger(value * 4)) fail(400, `Las horas deben ser de 0.25 a ${max}, en intervalos de 15 minutos.`);
  return Math.round(value * 60);
}
async function bodyOf(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'Se requiere un cuerpo JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) fail(413, 'El contenido es demasiado grande.');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { fail(400, 'Los datos enviados no son válidos.'); }
}
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
const cookie = token => `patoli_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`;
function csvCell(value) {
  let content = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(content) || /^[\t\r\n]/.test(content)) content = "'" + content;
  return '"' + content.replaceAll('"', '""') + '"';
}

export function createApp({ dbPath = resolve(root, 'data/patoli.sqlite'), setupToken = randomBytes(32).toString('hex') } = {}) {
  const db = openDatabase(dbPath);
  const instance = randomBytes(16).toString('hex');
  const limits = new Map();
  let boundPort;
  const setupRequired = () => !db.prepare("SELECT 1 FROM users WHERE role='admin'").get();
  function throttle(key, max) {
    const now = Date.now();
    for (const [k, bucket] of limits) if (bucket.until <= now) limits.delete(k);
    const bucket = limits.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    bucket.count++;
    limits.set(key, bucket);
    if (bucket.count > max) fail(429, 'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.');
  }
  function session(req) {
    const token = /(?:^|;\s*)patoli_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!token) fail(401, 'Inicia sesión para continuar.');
    const found = db.prepare('SELECT s.token_hash,s.csrf,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(sha(token), Date.now());
    if (!found) fail(401, 'Tu sesión terminó. Vuelve a iniciar sesión.');
    if (!['GET','HEAD'].includes(req.method) && req.headers['x-csrf-token'] !== found.csrf) fail(403, 'Actualiza la página antes de continuar.');
    return found;
  }
  function startSession(res, userId) {
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(sha(token), userId, csrf, Date.now() + SESSION_MS);
    res.setHeader('Set-Cookie', cookie(token));
    return { user: db.prepare(`SELECT ${publicColumns} FROM users WHERE id=?`).get(userId), csrf };
  }
  function audit(actorId, entryId, action, detail) {
    db.prepare('INSERT INTO audit(actor_id,entry_id,action,detail) VALUES(?,?,?,?)').run(actorId, entryId, action, JSON.stringify(detail));
  }
  function entryData(data, userId, exceptId = 0) {
    const date = dateField(data.date);
    if (date > today()) fail(400, 'No puedes registrar horas de una fecha futura.');
    const activity = textField(data.activity, 'Actividad', 3, 500);
    const minutes = hoursField(data.hours);
    const total = db.prepare("SELECT COALESCE(SUM(minutes),0) AS minutes FROM entries WHERE user_id=? AND date=? AND status IN ('pending','approved') AND id<>?").get(userId,date,exceptId).minutes;
    if (total + minutes > 1440) fail(400, 'La suma de horas pendientes y aprobadas no puede superar 24 en un día.');
    const duplicate = db.prepare("SELECT id FROM entries WHERE user_id=? AND date=? AND activity=? AND minutes=? AND status IN ('pending','approved') AND id<>?").get(userId,date,activity,minutes,exceptId);
    if (duplicate) fail(409, 'Ya enviaste esta jornada. Revisa tu historial.');
    return { date, activity, minutes };
  }
  function summary(userId) {
    const user = db.prepare(`SELECT ${publicColumns} FROM users WHERE id=?`).get(userId);
    const sums = db.prepare("SELECT status,SUM(minutes) AS minutes FROM entries WHERE user_id=? GROUP BY status").all(userId);
    const totals = { approved: 0, pending: 0, rejected: 0 };
    for (const row of sums) if (row.status in totals) totals[row.status] = row.minutes / 60;
    return { user, totals, remaining: Math.max(0,user.goal_minutes / 60 - totals.approved), percentage: Math.min(100,Math.round(totals.approved * 6000 / user.goal_minutes)) };
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const host = req.headers.host;
      if (![`127.0.0.1:${boundPort}`, `localhost:${boundPort}`].includes(host)) fail(403, 'Dirección no permitida.');
      const url = new URL(req.url, `http://${host}`);
      const path = url.pathname;
      const method = req.method;
      if (!['GET','HEAD'].includes(method) && req.headers.origin !== `http://${host}`) fail(403, 'Origen de solicitud no permitido.');
      if (path === '/api/health' && method === 'GET') return json(res,200,{ ok: true, app: 'Patoli', instance });
      if (path === '/api/config' && method === 'GET') return json(res,200,{ setupRequired: setupRequired(), today: today() });
      if (path === '/api/setup' && method === 'POST') {
        throttle('setup:' + req.socket.remoteAddress, 10);
        if (!setupRequired()) fail(409, 'La coordinación ya está configurada.');
        const data = await bodyOf(req);
        if (typeof data.token !== 'string' || !timingSafeEqual(Buffer.from(sha(data.token)), Buffer.from(sha(setupToken)))) fail(403, 'Abre Patoli desde INICIAR-PATOLI para configurar la coordinación.');
        const name = textField(data.name,'Nombre',2,150);
        const email = emailField(data.email);
        const password = await hashPassword(passwordField(data.password));
        const id = transaction(db, () => {
          if (!setupRequired()) fail(409,'La coordinación ya está configurada.');
          return Number(db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run(name,email,password).lastInsertRowid);
        });
        return json(res,201,startSession(res,id));
      }
      if (path === '/api/register' && method === 'POST') {
        throttle('register:' + req.socket.remoteAddress,30);
        if (setupRequired()) fail(409,'Primero debe configurarse la cuenta de coordinación.');
        const data = await bodyOf(req);
        const name = textField(data.name,'Nombre',2,150);
        const email = emailField(data.email);
        const university = textField(data.university,'Universidad',2,150);
        const degree = textField(data.degree ?? '','Carrera',0,150);
        const studentNumber = textField(data.student_number ?? '','Matrícula',0,60);
        if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) fail(409,'Este correo ya tiene una cuenta. Inicia sesión o pide ayuda a coordinación.');
        const password = await hashPassword(passwordField(data.password));
        const id = transaction(db, () => {
          if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) fail(409,'Este correo ya tiene una cuenta.');
          return Number(db.prepare("INSERT INTO users(name,email,password_hash,role,university,degree,student_number) VALUES(?,?,?,'student',?,?,?)").run(name,email,password,university,degree,studentNumber).lastInsertRowid);
        });
        return json(res,201,startSession(res,id));
      }
      if (path === '/api/login' && method === 'POST') {
        throttle('login-ip:' + req.socket.remoteAddress,60);
        const data = await bodyOf(req);
        const email = emailField(data.email);
        throttle('login-email:' + email,12);
        if (typeof data.password !== 'string' || data.password.length > 128) fail(401,'El correo o la contraseña no son correctos.');
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        const valid = await checkPassword(data.password,user?.password_hash);
        if (!user || !valid) fail(401,'El correo o la contraseña no son correctos.');
        limits.delete('login-email:' + email);
        return json(res,200,startSession(res,user.id));
      }
      if (path === '/api/events' && method === 'GET') {
        return json(res,200,{ events: db.prepare('SELECT id,title,date,time,location,description FROM events WHERE archived=0 AND date>=? ORDER BY date,time').all(today()) });
      }
      if (path.startsWith('/api/')) {
        const user = session(req);
        if (path === '/api/me' && method === 'GET') return json(res,200,{ ...summary(user.id), csrf: user.csrf });
        if (path === '/api/logout' && method === 'POST') {
          db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash);
          res.setHeader('Set-Cookie','patoli_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
          return json(res,200,{ ok: true });
        }
        if (path === '/api/password' && method === 'PUT') {
          throttle('password:' + user.id,12);
          const data = await bodyOf(req);
          if (typeof data.current_password !== 'string' || data.current_password.length > 128 || !await checkPassword(data.current_password,user.password_hash)) fail(400,'La contraseña actual no es correcta.');
          const password = passwordField(data.password);
          if (password === data.current_password) fail(400,'Elige una contraseña diferente a la actual.');
          const encoded = await hashPassword(password);
          transaction(db,() => {
            if (db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id).password_hash !== user.password_hash) fail(409,'Tu contraseña cambió en otra sesión. Inicia sesión de nuevo.');
            db.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?').run(encoded,user.id);
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
            audit(user.id,null,'password_changed',{ user_id: user.id });
          });
          return json(res,200,startSession(res,user.id));
        }
        if (user.must_change_password) fail(403,'Cambia tu contraseña temporal desde Perfil antes de continuar.');
        if (path === '/api/profile' && method === 'PUT') {
          const data = await bodyOf(req);
          const name = textField(data.name,'Nombre',2,150);
          const university = textField(data.university ?? '','Universidad',user.role === 'student' ? 2 : 0,150);
          const degree = textField(data.degree ?? '','Carrera',0,150);
          const studentNumber = textField(data.student_number ?? '','Matrícula',0,60);
          db.prepare('UPDATE users SET name=?,university=?,degree=?,student_number=? WHERE id=?').run(name,university,degree,studentNumber,user.id);
          return json(res,200,summary(user.id));
        }
        if (path === '/api/entries' && method === 'GET') {
          return json(res,200,{ entries: db.prepare("SELECT e.*,u.name AS reviewer_name FROM entries e LEFT JOIN users u ON u.id=e.reviewer_id WHERE e.user_id=? AND e.status<>'cancelled' ORDER BY e.date DESC,e.id DESC").all(user.id), ...summary(user.id) });
        }
        if (path === '/api/entries' && method === 'POST') {
          if (user.role !== 'student') fail(403,'Solo los estudiantes pueden enviar horas.');
          const data = await bodyOf(req);
          const clientId = textField(data.client_id,'Identificador de envío',16,80);
          const previous = db.prepare('SELECT * FROM entries WHERE user_id=? AND client_id=?').get(user.id,clientId);
          if (previous) return json(res,200,{ entry: previous });
          const entry = transaction(db,() => {
            const v = entryData(data,user.id);
            const id = Number(db.prepare('INSERT INTO entries(user_id,client_id,date,activity,minutes) VALUES(?,?,?,?,?)').run(user.id,clientId,v.date,v.activity,v.minutes).lastInsertRowid);
            audit(user.id,id,'submitted',v);
            return db.prepare('SELECT * FROM entries WHERE id=?').get(id);
          });
          return json(res,201,{ entry });
        }
        const entryMatch = /^\/api\/entries\/(\d+)$/.exec(path);
        if (entryMatch && ['PUT','DELETE'].includes(method)) {
          const data = await bodyOf(req);
          const entry = transaction(db,() => {
            const old = db.prepare('SELECT * FROM entries WHERE id=? AND user_id=?').get(Number(entryMatch[1]),user.id);
            if (!old || old.status === 'cancelled') fail(404,'No se encontró la jornada.');
            if (!['pending','rejected'].includes(old.status)) fail(409,'Las horas aprobadas ya no pueden modificarse.');
            if (data.version !== old.version) fail(409,'Esta jornada cambió. Actualiza la página antes de continuar.');
            if (method === 'DELETE') {
              db.prepare("UPDATE entries SET status='cancelled',version=version+1,updated_at=? WHERE id=?").run(stamp(),old.id);
              audit(user.id,old.id,'cancelled',{ previous: old });
            } else {
              const v = entryData(data,user.id,old.id);
              db.prepare("UPDATE entries SET date=?,activity=?,minutes=?,status='pending',review_note='',reviewer_id=NULL,reviewed_at=NULL,version=version+1,updated_at=? WHERE id=?").run(v.date,v.activity,v.minutes,stamp(),old.id);
              audit(user.id,old.id,'resubmitted',{ previous: old, next: v });
            }
            return db.prepare('SELECT * FROM entries WHERE id=?').get(old.id);
          });
          return json(res,200,{ entry });
        }
        if (path.startsWith('/api/admin/')) {
          if (user.role !== 'admin') fail(403,'Solo coordinación puede realizar esta acción.');
          if (path === '/api/admin/overview' && method === 'GET') {
            const students = db.prepare(`SELECT ${publicColumns.split(',').map(c=>'u.'+c).join(',')},
              COALESCE(SUM(CASE WHEN e.status='approved' THEN e.minutes ELSE 0 END),0)/60.0 AS approved_hours,
              COALESCE(SUM(CASE WHEN e.status='pending' THEN e.minutes ELSE 0 END),0)/60.0 AS pending_hours
              FROM users u LEFT JOIN entries e ON e.user_id=u.id WHERE u.role='student' GROUP BY u.id ORDER BY u.name`).all();
            const entries = db.prepare("SELECT e.*,u.name,u.email,u.university,r.name AS reviewer_name FROM entries e JOIN users u ON u.id=e.user_id LEFT JOIN users r ON r.id=e.reviewer_id WHERE e.status<>'cancelled' ORDER BY CASE e.status WHEN 'pending' THEN 0 ELSE 1 END,e.date DESC,e.id DESC").all();
            return json(res,200,{ students,entries,events: db.prepare('SELECT * FROM events ORDER BY date DESC,time').all() });
          }
          const reviewMatch = /^\/api\/admin\/entries\/(\d+)\/review$/.exec(path);
          if (reviewMatch && method === 'POST') {
            const data = await bodyOf(req);
            if (!['approved','rejected'].includes(data.status)) fail(400,'Selecciona aprobar o devolver.');
            const note = textField(data.note ?? '','Comentario',data.status === 'rejected' ? 3 : 0,500);
            const entry = transaction(db,() => {
              const old = db.prepare('SELECT * FROM entries WHERE id=?').get(Number(reviewMatch[1]));
              if (!old) fail(404,'No se encontró la jornada.');
              if (old.status !== 'pending' || old.version !== data.version) fail(409,'La jornada cambió o ya fue revisada. Actualiza la lista.');
              if (old.user_id === user.id) fail(403,'No puedes aprobar tus propias horas.');
              db.prepare('UPDATE entries SET status=?,review_note=?,reviewer_id=?,reviewed_at=?,version=version+1,updated_at=? WHERE id=?').run(data.status,note,user.id,stamp(),stamp(),old.id);
              audit(user.id,old.id,data.status,{ note, reviewed_version: old.version, minutes: old.minutes });
              return db.prepare('SELECT * FROM entries WHERE id=?').get(old.id);
            });
            return json(res,200,{ entry });
          }
          const goalMatch = /^\/api\/admin\/users\/(\d+)\/goal$/.exec(path);
          if (goalMatch && method === 'PUT') {
            const data = await bodyOf(req);
            const minutes = hoursField(data.hours,10000);
            const id = Number(goalMatch[1]);
            if (!db.prepare("SELECT 1 FROM users WHERE id=? AND role='student'").get(id)) fail(404,'No se encontró al estudiante.');
            transaction(db,() => {
              db.prepare('UPDATE users SET goal_minutes=? WHERE id=?').run(minutes,id);
              audit(user.id,null,'goal_changed',{ user_id: id, minutes });
            });
            return json(res,200,{ ok: true });
          }
          const resetMatch = /^\/api\/admin\/users\/(\d+)\/password$/.exec(path);
          if (resetMatch && method === 'PUT') {
            throttle('reset:' + user.id,20);
            const data = await bodyOf(req);
            const id = Number(resetMatch[1]);
            if (!db.prepare("SELECT 1 FROM users WHERE id=? AND role='student'").get(id)) fail(404,'No se encontró al estudiante.');
            const encoded = await hashPassword(passwordField(data.password));
            transaction(db,() => {
              db.prepare('UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?').run(encoded,id);
              db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
              audit(user.id,null,'password_reset',{ user_id: id });
            });
            return json(res,200,{ ok: true });
          }
          const eventMatch = /^\/api\/admin\/events\/(\d+)$/.exec(path);
          if ((path === '/api/admin/events' && method === 'POST') || (eventMatch && method === 'PUT')) {
            const data = await bodyOf(req);
            const title = textField(data.title,'Título',3,150);
            const date = dateField(data.date);
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time ?? '')) fail(400,'Selecciona una hora válida.');
            const location = textField(data.location,'Lugar',2,150);
            const description = textField(data.description,'Descripción',3,500);
            let id;
            if (eventMatch) {
              id = Number(eventMatch[1]);
              if (!db.prepare('SELECT 1 FROM events WHERE id=?').get(id)) fail(404,'No se encontró la actividad.');
              db.prepare('UPDATE events SET title=?,date=?,time=?,location=?,description=? WHERE id=?').run(title,date,data.time,location,description,id);
            } else {
              id = Number(db.prepare('INSERT INTO events(title,date,time,location,description,created_by) VALUES(?,?,?,?,?,?)').run(title,date,data.time,location,description,user.id).lastInsertRowid);
            }
            return json(res,eventMatch ? 200 : 201,{ id });
          }
          if (eventMatch && method === 'DELETE') {
            if (!db.prepare('UPDATE events SET archived=1 WHERE id=? AND archived=0').run(Number(eventMatch[1])).changes) fail(404,'No se encontró la actividad.');
            return json(res,200,{ ok: true });
          }
          if (path === '/api/admin/report.csv' && method === 'GET') {
            const rows = db.prepare("SELECT u.name,u.email,u.university,u.student_number,e.date,e.activity,e.minutes/60.0 AS hours,e.status,e.review_note,r.name AS reviewer,e.reviewed_at FROM entries e JOIN users u ON u.id=e.user_id LEFT JOIN users r ON r.id=e.reviewer_id WHERE e.status<>'cancelled' ORDER BY u.name,e.date").all();
            const labels = { pending: 'Pendiente',approved: 'Aprobado',rejected: 'Devuelto' };
            const table = [['Estudiante','Correo','Universidad','Matrícula','Fecha','Actividad','Horas','Estado','Comentario','Revisó','Fecha de revisión'], ...rows.map(r=>[r.name,r.email,r.university,r.student_number,r.date,r.activity,r.hours,labels[r.status],r.review_note,r.reviewer,r.reviewed_at])];
            res.writeHead(200,{ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="patoli-horas.csv"' });
            return res.end('\uFEFF' + table.map(row=>row.map(csvCell).join(',')).join('\r\n'));
          }
        }
        fail(404,'No se encontró esta opción.');
      }
      if (!['GET','HEAD'].includes(method)) fail(405,'Método no permitido.');
      const filename = path === '/' || path === '/index.html' ? 'home.html' : path.slice(1);
      const allowed = new Set(['home.html','login.html','registro.html','configurar.html','status.html','perfil.html','coordinacion.html','styles.css','app.css','common.js','home.js','login.js','status.js','perfil.js','coordinacion.js','images/patoli.png','images/pat_camp.webp','images/IMG_1520.webp','images/IMG_1625.webp']);
      if (!allowed.has(filename)) fail(404,'No se encontró la página.');
      const data = await readFile(resolve(root,'public',filename));
      const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp' };
      res.writeHead(200,{ 'Content-Type': mime[extname(filename)] || 'application/octet-stream' });
      res.end(method === 'HEAD' ? undefined : data);
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error('Error interno de Patoli:', error.code || error.name);
      if (!res.headersSent) json(res,status,{ error: status === 500 ? 'No se pudo guardar el cambio. Inténtalo de nuevo.' : error.message });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return {
    db, server, instance,
    async listen(port = 3000) {
      await new Promise((resolveListen,reject) => {
        server.once('error',reject);
        server.listen(port,'127.0.0.1',() => { server.off('error',reject); resolveListen(); });
      });
      boundPort = server.address().port;
      const url = `http://127.0.0.1:${boundPort}`;
      return { url, startUrl: setupRequired() ? `${url}/configurar.html#${setupToken}` : url };
    },
    async close() {
      if (server.listening) await new Promise((resolveClose,reject) => server.close(error => error ? reject(error) : resolveClose()));
      db.close();
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dbPath = process.env.PATOLI_DB || resolve(root,'data/patoli.sqlite');
  const app = createApp({ dbPath });
  try {
    const { url, startUrl } = await app.listen(Number(process.env.PORT || 3000));
    await writeFile(resolve(dirname(dbPath),'runtime.json'),JSON.stringify({ pid:process.pid,instance:app.instance,url,startUrl }));
    console.log(`Patoli está listo en ${url}`);
    if (startUrl !== url) console.log(`Configuración inicial (solo en este equipo): ${startUrl}`);
    if (process.argv.includes('--open') && process.platform === 'win32') {
      spawn('rundll32.exe',['url.dll,FileProtocolHandler',startUrl],{ windowsHide: true, stdio: 'ignore' }).unref();
    }
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{ await app.close(); process.exit(0); });
  } catch (error) {
    await app.close();
    console.error(error.code === 'EADDRINUSE' ? 'El puerto 3000 está ocupado. Si Patoli ya está abierto, visita http://127.0.0.1:3000.' : `No se pudo iniciar Patoli: ${error.message}`);
    process.exitCode = 1;
  }
}
