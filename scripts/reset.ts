/**
 * Limpia los datos locales (estado de solicitudes, colas simuladas, emails).
 * Detener el servidor antes de ejecutarlo:  npm run reset
 */
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../src/config';

const dataDir = path.join(process.cwd(), config.paths.dataDir);

if (!fs.existsSync(dataDir)) {
  console.log('No existe el directorio de datos, nada que limpiar.');
} else {
  const removed: string[] = [];
  for (const file of fs.readdirSync(dataDir)) {
    fs.rmSync(path.join(dataDir, file), { recursive: true, force: true });
    removed.push(file);
  }
  console.log(
    removed.length
      ? `Datos eliminados: ${removed.join(', ')}`
      : 'El directorio de datos ya estaba vacio.'
  );
}
