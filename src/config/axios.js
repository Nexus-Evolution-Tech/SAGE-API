const axios = require('axios');
const logger = require('./logger');

// Configuração global do axios
const createAxiosInstance = () => {
  const instance = axios.create({
    timeout: parseInt(process.env.CATRACA_TIMEOUT || '10000'),
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Interceptor de requisição
  instance.interceptors.request.use(
    (config) => {
      const url = config.url || 'unknown';
      logger.debug(`Request: ${config.method?.toUpperCase()} ${url}`);
      return config;
    },
    (error) => {
      logger.error(`Erro na requisição: ${error.message}`);
      return Promise.reject(error);
    }
  );

  // Interceptor de resposta com retry automático
  instance.interceptors.response.use(
    (response) => {
      const url = response.config.url || 'unknown';
      logger.debug(`← Response: ${response.status} ${url}`);
      return response;
    },
    async (error) => {
      const config = error.config;
      
      // Não fazer retry se não houver config
      if (!config) {
        return Promise.reject(error);
      }

      // Inicializar contador de retry
      if (!config.__retryCount) {
        config.__retryCount = 0;
      }

      const retries = parseInt(process.env.CATRACA_RETRY_ATTEMPTS || '3');
      const maxRetries = retries;

      // Incrementar contador
      config.__retryCount += 1;

      // Verificar se deve fazer retry
      const shouldRetry = config.__retryCount <= maxRetries && (
        // Erros de rede
        !error.response ||
        // Timeouts
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'EHOSTUNREACH' ||
        // Erros 5xx do servidor
        (error.response && error.response.status >= 500)
      );

      if (shouldRetry) {
        const retryDelay = config.__retryCount * parseInt(process.env.CATRACA_RETRY_DELAY || '1000');
        logger.warn(
          `Retry ${config.__retryCount}/${maxRetries} para ${config.url} em ${retryDelay}ms: ${error.message}`
        );

        // Aguardar antes de retentar
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        
        // Fazer a requisição novamente
        return instance(config);
      }

      // Se chegou aqui, falhar
      if (error.response) {
        logger.error(
          `HTTP ${error.response.status} em ${config.url}: ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        logger.error(`Sem resposta de ${config.url}: ${error.message}`);
      } else {
        logger.error(`Erro na configuração: ${error.message}`);
      }

      return Promise.reject(error);
    }
  );

  return instance;
};

// Instância singleton
const axiosInstance = createAxiosInstance();

module.exports = axiosInstance;
