const Joi = require('joi');
const logger = require('../config/logger');

// Schemas de validação

const pessoaSchema = Joi.object({
  nome: Joi.string().min(3).max(255).required().messages({
    'string.empty': 'Nome é obrigatório',
    'string.min': 'Nome deve ter no mínimo 3 caracteres',
    'string.max': 'Nome deve ter no máximo 255 caracteres'
  }),
  cpf: Joi.string().pattern(/^\d{11}$/).required().messages({
    'string.pattern.base': 'CPF deve conter 11 dígitos',
    'string.empty': 'CPF é obrigatório'
  }),
  email: Joi.string().email().allow(null, '').messages({
    'string.email': 'Email inválido'
  }),
  telefone: Joi.string().pattern(/^\d{10,11}$/).allow(null, '').messages({
    'string.pattern.base': 'Telefone inválido'
  }),
  data_nascimento: Joi.date().max('now').required().messages({
    'date.max': 'Data de nascimento não pode ser futura',
    'any.required': 'Data de nascimento é obrigatória'
  }),
  cartao_rfid: Joi.string().pattern(/^\d{8}$/).allow(null, '').messages({
    'string.pattern.base': 'Cartão RFID deve conter 8 dígitos'
  }),
  tipo: Joi.string().valid('ALUNO', 'PROFESSOR', 'FUNCIONARIO', 'RESPONSAVEL').required().messages({
    'any.only': 'Tipo inválido',
    'any.required': 'Tipo é obrigatório'
  })
});

const dispositivoSchema = Joi.object({
  nome: Joi.string().min(3).max(100).required(),
  modelo: Joi.string().max(50).allow(null, ''),
  endereco: Joi.string().ip({ version: ['ipv4'] }).required().messages({
    'string.ip': 'Endereço IP inválido'
  }),
  porta: Joi.number().integer().min(1).max(65535).required().messages({
    'number.min': 'Porta inválida',
    'number.max': 'Porta inválida'
  }),
  usuario: Joi.string().min(3).max(50).required(),
  senha: Joi.string().min(3).max(50).required()
});

const acessoSchema = Joi.object({
  pessoa_id: Joi.number().integer().positive().required(),
  dispositivo_id: Joi.number().integer().positive().required(),
  status: Joi.string().valid('ENTRADA', 'SAIDA').required(),
  metodo_auth: Joi.string().valid('CARTAO_RFID', 'QRCODE', 'BIOMETRIA').required()
});

const loginSchema = Joi.object({
  cpf: Joi.string().pattern(/^\d{11}$/).required(),
  senha: Joi.string().min(6).required()
});

// Middleware de validação
const validar = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Retorna todos os erros
      stripUnknown: true // Remove campos desconhecidos
    });

    if (error) {
      const errors = error.details.map(detail => ({
        campo: detail.path.join('.'),
        mensagem: detail.message
      }));

      logger.warn(`Validação falhou: ${JSON.stringify(errors)}`);

      return res.status(400).json({
        error: 'Dados inválidos',
        detalhes: errors
      });
    }

    // Substitui req.body pelos dados validados e sanitizados
    req.body = value;
    next();
  };
};

// Validar parâmetros de query
const validarQuery = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        campo: detail.path.join('.'),
        mensagem: detail.message
      }));

      logger.warn(`Validação query falhou: ${JSON.stringify(errors)}`);

      return res.status(400).json({
        error: 'Parâmetros inválidos',
        detalhes: errors
      });
    }

    req.query = value;
    next();
  };
};

// Validar parâmetros de rota
const validarParams = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        campo: detail.path.join('.'),
        mensagem: detail.message
      }));

      logger.warn(`Validação params falhou: ${JSON.stringify(errors)}`);

      return res.status(400).json({
        error: 'Parâmetros de rota inválidos',
        detalhes: errors
      });
    }

    req.params = value;
    next();
  };
};

module.exports = {
  validar,
  validarQuery,
  validarParams,
  schemas: {
    pessoaSchema,
    dispositivoSchema,
    acessoSchema,
    loginSchema
  }
};
