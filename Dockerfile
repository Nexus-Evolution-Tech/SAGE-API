# SAGE-API - Imagem Node para produção
FROM node:24-alpine

WORKDIR /app

# Copiar apenas arquivos de dependências primeiro (melhor cache de camadas)
COPY package.json package-lock.json ./

# Instalar apenas dependências de produção
# O postinstall depende de scripts que só são copiados na camada seguinte. No artefato de
# produção a configuração vem do ambiente; executar esse hook aqui tornava o build não reprodutível.
RUN npm ci --omit=dev --ignore-scripts

# Copiar código da aplicação
COPY index.js ./
COPY scripts ./scripts
COPY src ./src
COPY database ./database
COPY models ./models

# Pasta para uploads (fotos, logos) - persistida via volume no compose
RUN mkdir -p src/uploads

# A aplicação escuta na porta 3000 (interna; não exposta ao host no compose)
EXPOSE 3000

# NODE_ENV=production para usar node (não nodemon); npm start roda start-with-setup.js (setup do banco na primeira vez + servidor)
ENV NODE_ENV=production

CMD ["npm", "start"]
