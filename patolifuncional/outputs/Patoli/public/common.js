export const $ = selector => document.querySelector(selector);
export const formatHours = value => new Intl.NumberFormat('es-MX',{ maximumFractionDigits: 2 }).format(value);
export const formatDate = value => new Intl.DateTimeFormat('es-MX',{ day:'2-digit',month:'short',year:'numeric' }).format(new Date(value+'T12:00:00'));
export const labels = { pending:'En revisión', approved:'Aprobado', rejected:'Devuelto', cancelled:'Cancelado' };
export let current = null;
let csrf = '';
export function setSession(data) { current = data.user; csrf = data.csrf || csrf; }
export async function api(path, options = {}) {
  const { method = 'GET', body, ...rest } = options;
  let response;
  try {
    response = await fetch(path,{ ...rest, method, credentials:'same-origin', headers:{ ...(body !== undefined ? { 'Content-Type':'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token':csrf } : {}) }, ...(body !== undefined ? { body:JSON.stringify(body) } : {}) });
  } catch { throw new Error('No hay conexión con Patoli. Comprueba que el servidor siga abierto e inténtalo otra vez.'); }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && current) { location.replace('login.html?sesion=finalizada'); }
    const error = new Error(data.error || 'No se pudo completar la operación.');
    error.status = response.status;
    throw error;
  }
  return data;
}
export function el(tag, content, className) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (className) node.className = className;
  return node;
}
export function message(node, text = '', isError = false) {
  if (typeof node === 'string') node = $(node);
  node.textContent = text;
  node.classList.toggle('error',isError);
}
export function badge(status) { return el('span',labels[status],`badge ${status}`); }
export function button(text, action, className = 'button secondary small') {
  const node = el('button',text,className);
  node.type = 'button'; node.addEventListener('click',action); return node;
}
export async function busy(form, action) {
  const controls = [...form.querySelectorAll('button,input,textarea,select')];
  const before = controls.map(node=>node.disabled);
  controls.forEach(node=>node.disabled=true);
  try { return await action(); } finally { controls.forEach((node,i)=>node.disabled=before[i]); }
}
export async function init({ required = false, role } = {}) {
  try { setSession(await api('/api/me')); }
  catch (error) {
    if (error.status !== 401) { message('#page-message',error.message,true); return null; }
    if (required) { location.replace('login.html'); return null; }
  }
  const nav = $('header nav');
  if (nav) {
    const page = location.pathname.split('/').pop() || 'home.html';
    nav.replaceChildren();
    const links = [{ href:'home.html',label:'Inicio' }];
    if (current?.role === 'student') links.push({ href:'status.html',label:'Mi avance' });
    if (current?.role === 'admin') links.push({ href:'coordinacion.html',label:'Coordinación' });
    if (current) links.push({ href:'perfil.html',label:'Perfil' });
    else links.push({ href:'login.html',label:'Iniciar sesión' },{ href:'registro.html',label:'Crear cuenta' });
    for (const item of links) {
      const link = el('a',item.label); link.href = item.href;
      if (page === item.href) link.setAttribute('aria-current','page');
      nav.append(link);
    }
    if (current) nav.append(button('Salir',async()=>{
      try { await api('/api/logout',{ method:'POST' }); location.assign('login.html'); }
      catch (error) { message('#page-message',error.message,true); }
    },'nav-button'));
  }
  if (current?.must_change_password && !location.pathname.endsWith('/perfil.html')) { location.replace('perfil.html'); return null; }
  if (role && current && current.role !== role) { location.replace(current.role === 'admin' ? 'coordinacion.html' : 'status.html'); return null; }
  return current;
}
export async function config() { return api('/api/config'); }
export function showDialog(dialog) {
  dialog.showModal();
  dialog.querySelector('input:not([type=hidden]),textarea,button')?.focus();
}
export function wireDialogs() {
  document.querySelectorAll('[data-close]').forEach(node=>node.addEventListener('click',()=>node.closest('dialog').close()));
}
