#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const AULA_COLUMNS = ['nome', 'professor_id', 'materia_id', 'divisao', 'observacao'];
const HORARIO_COLUMNS = ['turma_id', 'aula_id', 'dia_semana', 'inicio', 'fim', 'sala_id'];
const DAYS = new Set(['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO']);
const DIVISIONS = new Set(['INT', 'DIV A', 'DIV B']);
const MAX_SEED_BYTES = 2 * 1024 * 1024;
const INSERT = (table) => new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(([^)]*)\\)\\s*VALUES\\s*([\\s\\S]*?);`, 'gi');

function fail(message) { throw new Error(`Seed de horários inválido: ${message}`); }
function sameColumns(actual, expected) {
  return actual.map((item) => item.trim().toLowerCase()).join(',') === expected.join(',');
}
function valuesOf(source, startLine) {
  const rows = [];
  let quote = null, token = '', fields = [], tuple = false, tupleLine = null;
  const push = () => { fields.push(valueOf(token)); token = ''; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      token += char;
      if (char === '\\' && i + 1 < source.length) token += source[++i];
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"') { quote = char; token += char; }
    else if (char === '(') {
      if (tuple || token.trim()) fail('tupla malformada');
      tuple = true; fields = []; tupleLine = startLine + source.slice(0, i).split('\n').length - 1;
    }
    else if (char === ',') { if (tuple) push(); else if (token.trim()) fail('separador fora de tupla'); }
    else if (char === ')') {
      if (!tuple) fail('fechamento sem tupla');
      push(); rows.push({ values: fields, line: tupleLine }); token = ''; tuple = false;
    }
    else token += char;
  }
  if (quote || tuple || token.trim()) fail('tupla incompleta');
  return rows;
}
function valueOf(raw) {
  const value = raw.trim();
  if (/^null$/i.test(value)) return null;
  if (/^\d+$/.test(value)) return Number(value);
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1).replace(/\\(.)/g, '$1').replace(/''/g, "'");
  }
  fail(`valor SQL não permitido: ${value.slice(0, 40)}`);
}
function requiredInt(value, label, allowNull = false) {
  if (allowNull && value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} deve ser inteiro positivo`);
  return value;
}
function sql(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}
function extract(source, table, columns) {
  const found = [...source.matchAll(INSERT(table))];
  if (found.length !== 9) fail(`esperados 9 blocos de ${table}; encontrados ${found.length}`);
  return found.map((match, index) => {
    if (!sameColumns(match[1].split(','), columns)) fail(`colunas de ${table} no bloco ${index + 1} são incompatíveis`);
    const bodyOffset = match.index + match[0].indexOf(match[2]);
    const rows = valuesOf(match[2], source.slice(0, bodyOffset).split('\n').length);
    if (!rows.length || rows.some((row) => row.values.length !== columns.length)) fail(`tuplas de ${table} no bloco ${index + 1} são incompatíveis`);
    return rows;
  });
}
function divisionOf(value, divisionAB) {
  if (DIVISIONS.has(value)) return value;
  if (value === 'DIV A/B' && divisionAB === 'INT') return 'INT';
  if (value === 'DIV A/B') fail('DIV A/B requer política explícita: divisionAB: "INT"');
  fail('divisao da Aula inválida');
}
function minutes(time) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)); }
function parseScheduleSeed(source, { divisionAB } = {}) {
  if (typeof source !== 'string') throw new TypeError('source deve ser uma string SQL');
  if (Buffer.byteLength(source, 'utf8') > MAX_SEED_BYTES) fail(`arquivo excede ${MAX_SEED_BYTES} bytes`);
  const aulas = extract(source, 'Aula', AULA_COLUMNS);
  const horarios = extract(source, 'HorarioAula', HORARIO_COLUMNS);
  const report = { invalid: [], crossesMidnight: [], startsBeforeFour: [] };
  const blocks = aulas.map((rows, index) => {
    const aula = rows.map(({ values: [nome, professorId, materiaId, divisao, observacao] }) => {
      if (typeof nome !== 'string' || !nome || nome.length > 50) fail(`nome da Aula no bloco ${index + 1}`);
      if (observacao !== null && (typeof observacao !== 'string' || observacao.length > 255)) fail(`observacao da Aula no bloco ${index + 1}`);
      return { nome, professorId: requiredInt(professorId, 'professor_id', true), materiaId: requiredInt(materiaId, 'materia_id'), divisao: divisionOf(divisao, divisionAB), observacao };
    });
    const turmaIds = new Set();
    const horario = horarios[index].map(({ values: [turmaId, aulaId, dia, inicio, fim, salaId], line }) => {
      turmaId = requiredInt(turmaId, 'turma_id'); aulaId = requiredInt(aulaId, 'aula_id'); salaId = requiredInt(salaId, 'sala_id', true);
      if (aulaId > aula.length) fail(`aula_id ${aulaId} sem referência local no bloco ${index + 1}`);
      if (!DAYS.has(dia)) fail(`dia_semana inválido no bloco ${index + 1}`);
      if (![inicio, fim].every((time) => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d:00$/.test(time))) fail(`horário inválido no bloco ${index + 1}`);
      const start = minutes(inicio), end = minutes(fim);
      const label = `${inicio}-${fim} (bloco ${index + 1}, linha ${line})`;
      if (start < 240) report.startsBeforeFour.push(label);
      if (end === start || (end < start && end > 240)) report.invalid.push(label);
      else if (end < start) report.crossesMidnight.push(label);
      turmaIds.add(turmaId); return { turmaId, aulaId, divisao: aula[aulaId - 1].divisao, dia, horario: `${inicio.slice(0, 5)}-${fim.slice(0, 5)}`, salaId };
    });
    if (turmaIds.size !== 1) fail(`bloco ${index + 1} referencia mais de uma turma`);
    return { aula, horario };
  });
  if (report.invalid.length) fail(`intervalos inválidos: ${report.invalid.join(', ')}; cruzam meia-noite: ${report.crossesMidnight.join(', ') || 'nenhum'}; inícios <04:00: ${report.startsBeforeFour.join(', ') || 'nenhum'}`);
  return blocks;
}
function convertScheduleSeed(source, options) {
  const blocks = parseScheduleSeed(source, options);
  let aulaBase = 1;
  const statements = blocks.map(({ aula, horario }) => {
    const catalog = aula.map(({ nome, professorId, materiaId, observacao }, offset) => `(${[aulaBase + offset, nome, professorId, materiaId, observacao].map(sql).join(', ')})`).join(',\n');
    const schedule = horario.map(({ turmaId, aulaId, divisao, dia, horario: time, salaId }) => `(${turmaId}, ${aulaBase + aulaId - 1}, ${sql(divisao)}, ${sql(dia)}, ${sql(time)}, ${sql(salaId)})`).join(',\n');
    aulaBase += aula.length;
    return `INSERT INTO Aula (id, nome, professor_id, materia_id, observacao) VALUES\n${catalog};\nINSERT INTO HorarioAula (turma_id, aula_id, divisao, dia_semana, horario, sala_id) VALUES\n${schedule};`;
  });
  return `START TRANSACTION;\n${statements.join('\n\n')}\nCOMMIT;\n`;
}
function convertFile(input, output, options) {
  if (!output) throw new Error('Informe o arquivo de saída explicitamente');
  if (path.resolve(input) === path.resolve(output)) throw new Error('A saída não pode sobrescrever o seed de entrada');
  if (fs.statSync(input).size > MAX_SEED_BYTES) fail(`arquivo excede ${MAX_SEED_BYTES} bytes`);
  const source = fs.readFileSync(input, 'utf8');
  fs.writeFileSync(output, convertScheduleSeed(source, options), { flag: 'wx' });
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = {};
    if (args.includes('--division-a-b=INT')) options.divisionAB = 'INT';
    if (args.some((arg) => arg.startsWith('--') && arg !== '--division-a-b=INT')) fail('opção inválida');
    const positional = args.filter((arg) => !arg.startsWith('--'));
    if (positional.length > 2) fail('argumentos posicionais em excesso');
    const [input = path.join(__dirname, '..', 'database', 'dados_etec_taboao-horarios-atualizados.sql'), output] = positional;
    convertFile(input, output, options);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { convertFile, convertScheduleSeed, parseScheduleSeed };
