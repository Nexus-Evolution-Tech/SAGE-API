const deviceService = require('../services/deviceService');
const gerarController = require('./genericControllerFactory');
const { buscarTodos } = require('../utils/generic-db-utils');
const { discoverControlId, getLocalPrivateCidrs } = require('../services/networkDiscoveryService');
const { criarRegistro } = require('../utils/generic-db-utils');

const tabela = 'Dispositivo';
const campos = ['id', 'nome', 'modelo', 'endereco', 'porta', 'usuario', 'senha', 'area_id', 'numero_serial'];

const getStatus = async (req, res) => {
  const statusDispositivos = [];
  const dispositivos = await buscarTodos(tabela, campos);

  if (!dispositivos) {
    return res.status(500).json({ message: 'Erro ao buscar dispositivos do banco de dados' });
  }

  for (const dispositivo of dispositivos) {
    const link = deviceService.linkCatraca(dispositivo);
    const session = await deviceService.obterSessao(link, dispositivo);

    if (!session) {
      statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'OFFLINE' });
      continue;
    }

    const sessaoValida = await deviceService.verificarSessao(session, link);
    if (sessaoValida) {
    statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'ONLINE' });
    } else {
    statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'Sessão inválida' });
    }
  }

  res.json(statusDispositivos);
};

const getStatusId = async (req, res) => {
  const { id } = req.params;
  const dispositivos = await buscarTodos(tabela, campos);

  if (!dispositivos) {
    return res.status(500).json({ message: 'Erro ao buscar dispositivos do banco de dados' });
  }

  const dispositivo = dispositivos.find(d => d.id == id);

  if (!dispositivo) {
    return res.status(404).json({ message: 'Dispositivo não encontrado' });
  }

  const link = deviceService.linkCatraca(dispositivo);
  const session = await deviceService.obterSessao(link, dispositivo);

  if (!session) {
    return res.json({ id: dispositivo.id, nome: dispositivo.nome, status: 'OFFLINE' });
  }

  const sessaoValida = await deviceService.verificarSessao(session, link);
  if (sessaoValida) {
    return res.json({ id: dispositivo.id, nome: dispositivo.nome, status: 'ONLINE' });
  } else {
    return res.json({ id: dispositivo.id, nome: dispositivo.nome, status: 'Sessão inválida' });
  }
};

const controllerGenerico = gerarController(tabela, campos, 'dispositivo');
module.exports = {
  ...controllerGenerico,
  getStatus,
  getStatusId,
  async discover(req, res) {
    try {
      const { cidr, ports, timeout, concurrency } = req.query;
      const parsedPorts = ports ? String(ports).split(',').map(p => parseInt(p.trim(), 10)).filter(Boolean) : [80, 82];
      const result = await discoverControlId({
        cidr: cidr || undefined,
        ports: parsedPorts,
        timeoutMs: timeout ? parseInt(timeout, 10) : 1200,
        concurrency: concurrency ? parseInt(concurrency, 10) : 64
      });
      res.json({ cidrs: result.cidrs, found: result.found });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao descobrir dispositivos na rede', error: error.message });
    }
  },
  async quickAdd(req, res) {
    try {
      const { ip, port, usuario, senha, nome, area_id, modelo, numero_serial } = req.body;
      if (!ip || !port || !usuario || !senha) {
        return res.status(400).json({ message: 'ip, port, usuario e senha são obrigatórios' });
      }

      const payload = {
        nome: nome || `Catraca ${ip}:${port}`,
        modelo: modelo || 'IDAccess',
        endereco: ip,
        porta: String(port),
        usuario,
        senha,
        area_id: area_id || null,
        numero_serial: numero_serial || null
      };

      await criarRegistro(tabela, payload);

      // Testa conexão
      const ok = await deviceService.testarConexaoCatraca({
        nome: payload.nome,
        endereco: payload.endereco,
        porta: payload.porta,
        usuario: payload.usuario,
        senha: payload.senha
      });

      res.status(201).json({ message: 'Dispositivo criado', data: payload, conectado: !!ok });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao criar dispositivo', error: error.message });
    }
  }
}