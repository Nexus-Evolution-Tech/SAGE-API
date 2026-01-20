const gerarController = require('./genericControllerFactory');
const { criarAcesso } = require('../services/accessService');
const verificarEAtribuirPresenca = require('../services/presenceService');
const { emitToRoom } = require('../websocket/wsServer');
const globalState = require('../state/globalState');
const { cacheMutation, CACHE_KEYS } = require('../cache/helpers');
const logger = require('../config/logger');

const tabela = 'Acesso';
const campos = ['id', 'pessoa_id', 'dispositivo_id', 'status', 'permitido', 'metodo_auth', 'data_hora', 'updated_at'];

const criar = async (req, res) => {
    const { pessoa_id, dispositivo_id, status, metodo_auth } = req.body;

    if (
        pessoa_id === undefined || 
        dispositivo_id === undefined || 
        status === undefined || 
        metodo_auth === undefined
    ) {
        return res.status(400).json({ message: 'Dados incompletos para criar acesso' });
    }

    try {
        const acesso = await criarAcesso(req.body);
        
        // Atualizar estatísticas
        if (acesso.acesso?.permitido) {
            globalState.incrementAcessoTodiaSuccesso();
        } else {
            globalState.incrementAcessoTodayNegado();
        }

        // Invalidar cache de acessos
        await cacheMutation(
            async () => acesso,
            [
                CACHE_KEYS.INVALIDATE_ACESSOS,
                CACHE_KEYS.ACESSOS_HOJE
            ]
        );

        // Emitir evento WebSocket
        emitToRoom('acessos', 'acesso:novo', {
            pessoa_id,
            dispositivo_id,
            status,
            permitido: acesso.acesso?.permitido,
            data_hora: acesso.acesso?.data_hora || new Date()
        });

        // Emitir atualização de estatísticas
        emitToRoom('stats', 'stats:update', globalState.getStats());

        // ✅ Computa presença e atraso imediatamente
        const data_hora = acesso.acesso?.data_hora || new Date();
        await verificarEAtribuirPresenca(pessoa_id, data_hora);

        logger.debug(`[ACCESS] Novo acesso registrado: pessoa ${pessoa_id}, dispositivo ${dispositivo_id}`);
        res.status(201).json(acesso);
    } catch (error) {
        logger.error(`[ACCESS ERROR] ${error.message}`);
        res.status(500).json({ message: 'Erro ao efetuar acesso', error: error.message });
    }
};

const controllerGenerico = gerarController(tabela, campos, 'acesso');

module.exports = {
    ...controllerGenerico,
    criar
};
