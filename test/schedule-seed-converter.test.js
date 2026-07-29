const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { convertFile, convertScheduleSeed, parseScheduleSeed } = require('../scripts/convert-schedule-seed');

const root = path.join(__dirname, '..');
const input = path.join(root, 'database', 'dados_etec_taboao-horarios-atualizados.sql');
const source = fs.readFileSync(input, 'utf8');
const count = (text, table) => (text.match(new RegExp(`INSERT INTO ${table} \\(`, 'g')) || []).length;
const policy = { divisionAB: 'INT' };
const correctedFixture = source.replace('"19:10:00", "19:00:00"', '"18:10:00", "19:00:00"');

describe('conversor do seed de horários', () => {
  it('identifica os nove pares e bloqueia o seed real até haver política para os dados ambíguos', () => {
    expect(count(source, 'Aula')).toBe(9); expect(count(source, 'HorarioAula')).toBe(9);
    expect(source.match(/"DIV A\/B"/g)).toHaveLength(27);
    expect(() => parseScheduleSeed(source)).toThrow(/política explícita/);
    expect(() => parseScheduleSeed(source, policy)).toThrow(/intervalos inválidos: 19:10:00-19:00:00 \(bloco 7, linha 474\); cruzam meia-noite: .*inícios <04:00: 00:20:00-02:00:00 \(bloco 7, linha 490\)/);
  });

  it('aplica DIV A/B somente por política explícita e gera o recorte canônico para fixture válida', () => {
    const blocks = parseScheduleSeed(correctedFixture, policy);
    const converted = convertScheduleSeed(correctedFixture, policy);
    expect(converted).toMatch(/^START TRANSACTION;\n/);
    expect(converted).toMatch(/\nCOMMIT;\n$/);
    expect(count(converted, 'Aula')).toBe(9); expect(count(converted, 'HorarioAula')).toBe(9);
    expect(converted).not.toMatch(/LAST_INSERT_ID|auto_increment_increment/);
    expect(converted).toMatch(/INSERT INTO Aula \(id, nome, professor_id, materia_id, observacao\) VALUES\n\(1,/);
    expect(converted).toMatch(/\(208, 'HISTÓRIA - DIEGO - EAD', 871, 38, NULL\)/);
    expect(converted).toMatch(/INSERT INTO HorarioAula [\s\S]*\n\(2, 25,/);
    expect(converted.match(/'(?:22:40|23:20)-00:20'/g)).toHaveLength(8);
    expect(converted).toMatch(/'00:20-02:00'/);
    expect(blocks).toHaveLength(9);
    expect(blocks.reduce((n, block) => n + block.aula.length, 0)).toBe(208);
    expect(blocks.reduce((n, block) => n + block.horario.length, 0)).toBe(213);
    expect(converted).toMatch(/'TERÇA'/); expect(converted).not.toMatch(/\bUnidadeEscolar\b|\bDispositivo\b|\bsenha\b|\bcatraca\b/i);
    expect(converted).not.toMatch(/INSERT INTO Aula \([^)]*divisao/i);
    expect(converted).toMatch(/'\d\d:\d\d-\d\d:\d\d'/);
    const longSameTurn = correctedFixture.replace('"07:30:00", "08:20:00"', '"07:30:00", "18:20:00"');
    expect(() => parseScheduleSeed(longSameTurn, policy)).not.toThrow();
    const zeroDuration = correctedFixture.replace('"07:30:00", "08:20:00"', '"07:30:00", "07:30:00"');
    expect(() => parseScheduleSeed(zeroDuration, policy)).toThrow(/intervalos inválidos: 07:30:00-07:30:00/);
  });

  it('não grava saída do seed bloqueado nem permite sobrescrever o seed fonte', () => {
    const output = path.join(root, `.schedule-${process.pid}.sql`);
    expect(() => convertFile(input, output, policy)).toThrow(/intervalos inválidos/);
    expect(fs.existsSync(output)).toBe(false);
    expect(() => convertScheduleSeed(correctedFixture.replace('"INT"', '"DIV C"'), policy)).toThrow(/divisao/);
    expect(() => convertFile(input, input)).toThrow(/sobrescrever/);
    expect(() => parseScheduleSeed('x'.repeat(2 * 1024 * 1024 + 1), policy)).toThrow(/excede/);
    const cli = spawnSync(process.execPath, ['scripts/convert-schedule-seed.js'], { cwd: root, encoding: 'utf8' });
    expect(cli.status).toBe(1); expect(cli.stderr).toMatch(/arquivo de saída explicitamente/);
    const cliOutput = path.join(root, `.schedule-cli-${process.pid}.sql`);
    const blockedCli = spawnSync(process.execPath, ['scripts/convert-schedule-seed.js', input, cliOutput, '--division-a-b=INT'], { cwd: root, encoding: 'utf8' });
    expect(blockedCli.status).toBe(1); expect(blockedCli.stderr).toMatch(/linha 474/);
    expect(fs.existsSync(cliOutput)).toBe(false);
  });
});
