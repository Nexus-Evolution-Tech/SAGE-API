const fs = require('fs');
const path = require('path');
const controller = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'schoolController.js'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'schoolRoutes.js'), 'utf8');

describe('onboarding inicial do SAGE', () => {
  it('expõe status e inicialização pública somente para primeiro uso', () => {
    expect(routes).toContain("routerExtra.get('/setup/status'");
    expect(routes).toContain("routerExtra.post('/setup/initialize'");
    expect(routes).toContain('listar: false');
    expect(routes).toContain('criar: true');
    expect(controller).toContain("SELECT GET_LOCK('sage_first_run_onboarding'");
    expect(controller).toContain('SELECT COUNT(*) AS total FROM UnidadeEscolar');
    expect(controller).toContain('INSERT INTO UnidadeEscolar (nome, login, senha)');
  });

  it('restringe inicialização à própria máquina e nunca devolve hash', () => {
    expect(controller).toContain('isLoopbackRequest');
    expect(controller).toContain('status(403)');
    expect(controller).toContain('hashSenha');
    expect(controller).not.toMatch(/res\.(?:json|send)\([^)]*senhaHash/s);
  });
});
