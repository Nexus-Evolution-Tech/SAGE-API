const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const logger = require('../src/config/logger');
const { responderErroInterno } = require('../src/utils/responderErroInterno');
function lerJavaScript(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const arquivo = path.join(dir, entry.name);
    return entry.isDirectory() ? lerJavaScript(arquivo) : entry.name.endsWith('.js')
      ? [fs.readFileSync(arquivo, 'utf8')] : [];
  });
}
describe('R1-04D — erro interno e boot de rotas', () => {
  it('devolve somente contrato público e correlaciona detalhe sanitizado', () => {
    const response = { locals: {}, status: vi.fn().mockReturnThis(), json: vi.fn() };
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    responderErroInterno(response, new Error('falha CPF 123.456.789-09'), 'Falha pública');
    const body = response.json.mock.calls[0][0];
    expect(Object.keys(body)).toEqual(['error', 'traceId']);
    expect(body.error).toBe('Falha pública');
    expect(spy.mock.calls[0][1].traceId).toBe(body.traceId);
    expect(spy.mock.calls[0][1].detalhe).not.toBeInstanceOf(Error);
    expect(JSON.stringify(spy.mock.calls[0][1])).not.toContain('123.456.789-09');
    spy.mockRestore();
  });
  it('mantém o guard estático contra detalhe em respostas 500', () => {
    const fonte = lerJavaScript(path.join(__dirname, '..', 'src')).join('\n');
    expect(fonte).not.toMatch(/res\.status\(500\)\.json\([\s\S]{0,300}(?:error|err)\.message/);
    expect(fonte).not.toMatch(/res\.status\(500\)\.json\([\s\S]{0,300}(?:detalhe|stack)\s*:/);
    expect(fonte).toContain("responderErroInterno(res, detalhe, 'Erro interno no servidor')");
    expect(fonte).not.toContain('body?.error');
  });
  it('falha o processo para rota essencial e segue com degradação para não essencial', () => {
    const app = path.join(__dirname, '..', 'src', 'app.js');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-r1-04d-'));
    const script = `const M=require('module'), old=M._load;
M._load=(r,p,m)=>r==='./config/loadRoutes'?()=>{const a=['accessRoutes.js','deviceRoutes.js','notificationRoutes.js','peopleRoutes.js','schoolRoutes.js'];a.failures=[{file:process.env.FAIL_ROUTE,error:new Error('rota quebrada')}];return a}:old(r,p,m);
try{const a=require(${JSON.stringify(app)}),h=require('http'),s=h.createServer(a).listen(0,'127.0.0.1',()=>h.get({port:s.address().port,path:'/ready'},r=>{let b='';r.on('data',x=>b+=x);r.on('end',()=>{process.stdout.write('booted '+b);s.close(()=>process.exit(0))})}))}catch(e){process.stderr.write(e.message);process.exitCode=1}`;
    const run = (route) => spawnSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, FAIL_ROUTE: route, SAGE_DATA_DIR: data, NODE_ENV: 'test' }
    });
    const essential = run('accessRoutes.js');
    const optional = run('horarioRoutes.js');
    expect(essential.status).not.toBe(0);
    expect(`${essential.stdout}${essential.stderr}`).toContain('ROTAS_ESSENCIAIS_INDISPONIVEIS');
    expect(optional.status).toBe(0);
    expect(optional.stdout).toContain('routes_incomplete');
    fs.rmSync(data, { recursive: true, force: true });
  });
});
