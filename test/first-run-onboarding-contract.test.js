const fs = require('fs');
const path = require('path');
const controller = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'schoolController.js'), 'utf8');
const setup = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-database.js'), 'utf8');
const { FIRST_RUN_BOOTSTRAP_LOCK } = require('../src/config/env');
const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'schoolRoutes.js'), 'utf8');

describe('onboarding inicial do SAGE', () => {
  it('expõe status e inicialização pública somente para primeiro uso', () => {
    expect(routes).toContain("routerExtra.get('/setup/status'");
    expect(routes).toContain("routerExtra.post('/setup/initialize'");
    expect(routes).toContain('listar: false');
    expect(routes).toContain('criar: true');
    expect(controller).toContain('FIRST_RUN_BOOTSTRAP_LOCK');
    expect(controller).toContain('await connection.beginTransaction()');
    expect(controller).toContain('SELECT COUNT(*) AS total FROM UnidadeEscolar');
    expect(controller).toMatch(/INSERT INTO UnidadeEscolar\s+\(nome, login, senha,/);
    expect(controller).toMatch(/INSERT INTO Usuario[\s\S]+ADMINISTRADOR/);
  });

  it('compartilha o lock entre onboarding HTTP e setup por ambiente', () => {
    expect(setup).toContain('FIRST_RUN_BOOTSTRAP_LOCK');
    expect(FIRST_RUN_BOOTSTRAP_LOCK).toBe('sage_first_run_onboarding');
  });

  it('restringe inicialização à própria máquina e nunca devolve hash', () => {
    expect(controller).toContain('isLoopbackRequest');
    expect(controller).toContain('status(403)');
    expect(controller).toContain('hashSenha');
    expect(controller).not.toMatch(/res\.(?:json|send)\([^)]*senhaHash/s);
  });
});
