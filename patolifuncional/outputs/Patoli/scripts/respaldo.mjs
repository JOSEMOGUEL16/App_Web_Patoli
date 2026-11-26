import { DatabaseSync,backup } from 'node:sqlite';
import { mkdir,access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..',import.meta.url));
const source = process.env.PATOLI_DB || resolve(root,'data/patoli.sqlite');
try { await access(source); } catch { console.error('Primero inicia Patoli para crear su base de datos.'); process.exit(1); }
const destination = resolve(root,'backups',`patoli-${new Date().toISOString().replaceAll(':','-').replaceAll('.','-')}.sqlite`);
await mkdir(resolve(root,'backups'),{ recursive:true });
const db = new DatabaseSync(source,{ readOnly:true });
try { await backup(db,destination); console.log(`Respaldo completo guardado en: ${destination}`); }
finally { db.close(); }
