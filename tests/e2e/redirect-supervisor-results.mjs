import fs from 'node:fs';
import path from 'node:path';

const destination = process.env.BOLGESCOPE_EVIDENCE_DIR;
if (!destination) throw new Error('BOLGESCOPE_EVIDENCE_DIR is required');
fs.mkdirSync(destination, { recursive: true });

const resultNames = new Set([
  'codec-results.json',
  'source-results.json',
  'machine-results.json',
  'debugger-results.json',
  'worker-results.json',
]);
const writeFileSync = fs.writeFileSync.bind(fs);
fs.writeFileSync = (file, data, options) => {
  const fileName = path.basename(String(file));
  const target = resultNames.has(fileName) ? path.join(destination, fileName) : file;
  return writeFileSync(target, data, options);
};
