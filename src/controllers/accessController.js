const gerarController = require('./genericControllerFactory');
const { criarAcesso } = require('../services/accessService');
const { emitToRoom } = require('../websocket/wsServer');
const globalState = require('../state/globalState');
const { cacheMutation, cacheQuery, CACHE_KEYS, CACHE_TTL } = require('../cache/helpers');
const logger = require('../config/logger');
const db = require('../config/database');
const ajustarFusoHorarioBrasil = require('../utils/ajustaFusoHorario');

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

        // Emitir evento WebSocket (data_hora em ISO UTC para exibir em horário local no frontend)
        const data_hora = acesso.acesso?.data_hora || new Date();
        const data_hora_iso = data_hora instanceof Date ? data_hora.toISOString() : new Date(data_hora).toISOString();
        let pessoa_nome = null;
        try {
            const [rows] = await db.query('SELECT nome FROM Pessoa WHERE id = ? LIMIT 1', [pessoa_id]);
            pessoa_nome = rows?.[0]?.nome ?? null;
        } catch (_) { logger.warn('[ACESSO] codigo=NOME_PESSOA_NAO_CARREGADO'); }
        emitToRoom('acessos', 'acesso:novo', {
            pessoa_id,
            dispositivo_id,
            status,
            permitido: acesso.acesso?.permitido,
            data_hora: data_hora_iso,
            pessoa_nome
        });

        // Emitir atualização de estatísticas
        emitToRoom('stats', 'stats:update', globalState.getStats());

        logger.debug(`[ACCESS] Novo acesso registrado: pessoa ${pessoa_id}, dispositivo ${dispositivo_id}`);
        res.status(201).json(acesso);
    } catch (error) {
        logger.error(`[ACCESS ERROR] ${error.message}`);
        res.status(500).json({ message: 'Erro ao efetuar acesso', error: error.message });
    }
};

const controllerGenerico = gerarController(tabela, campos, 'acesso');

/** Listar acessos por id DESC (mais recentes primeiro) para a tela de monitoramento.
 *  Só busca a página atual (LIMIT/OFFSET) e o total por COUNT — nunca carrega todos os registros. */
const listar = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    try {
        const cacheKey = `acessos:list:page${page}:limit${limit}`;
        // TTL curto para página 1 (monitoramento) para F5/refetch mostrar novo acesso logo
        const ttl = page === 1 && limit <= 50 ? CACHE_TTL.SHORT : CACHE_TTL.MEDIUM;
        const result = await cacheQuery(
            cacheKey,
            async () => {
                const [registros] = await db.query(
                    `SELECT ${campos.join(', ')} FROM ${tabela} ORDER BY id DESC LIMIT ? OFFSET ?`,
                    [limit, offset]
                );
                const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM ${tabela}`);
                return {
                    data: ajustarFusoHorarioBrasil(registros),
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                };
            },
            ttl
        );
        res.json(result);
    } catch (error) {
        logger.error(`Erro ao listar acessos: ${error.message}`);
        res.status(500).json({ message: 'Erro ao listar acessos', error: error.message });
    }
};

module.exports = {
    ...controllerGenerico,
    listar,
    criar
};
