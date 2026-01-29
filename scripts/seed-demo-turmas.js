/*
 * Seed simples para criar turmas de exemplo.
 * Uso: node scripts/seed-demo-turmas.js
 */
const db = require('../src/config/database');

async function main() {
  const turmas = [
    '1º Ano A',
    '1º Ano B',
    '2º Ano A',
    '2º Ano B',
    '3º Ano A',
    '3º Ano B'
  ];

  try {
    for (const nome of turmas) {
      await db.query('INSERT IGNORE INTO Turma (nome) VALUES (?)', [nome]);
    }
    console.log(`✅ Turmas inseridas: ${turmas.join(', ')}`);
    process.exit(0);
  } catch (err) {
    console.error('Erro ao inserir turmas:', err.message);
    process.exit(1);
  }
}

main();
