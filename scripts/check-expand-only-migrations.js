const fs = require('fs/promises');
const path = require('path');

const FORBIDDEN_DDL = /\b(?:DROP\s+COLUMN|RENAME\s+(?:COLUMN|TABLE)|CHANGE\s+COLUMN)\b/gi;

async function findForbiddenMigrations(databaseDir) {
  const files = (await fs.readdir(databaseDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'));
  const findings = [];
  for (const file of files) {
    const sql = await fs.readFile(path.join(databaseDir, file.name), 'utf8');
    const executable = sql.replace(/^\s*--.*$/gm, '');
    for (const match of executable.matchAll(FORBIDDEN_DDL)) {
      findings.push({
        file: file.name,
        line: executable.slice(0, match.index).split('\n').length,
        operation: match[0].replace(/\s+/g, ' ').toUpperCase()
      });
    }
  }
  return findings;
}

async function main() {
  const findings = await findForbiddenMigrations(path.join(__dirname, '..', 'database'));
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: DDL bloqueado: ${finding.operation}`);
  }
  if (findings.length) process.exitCode = 1;
}

if (require.main === module) main().catch(() => { process.exitCode = 1; });

module.exports = { findForbiddenMigrations };
