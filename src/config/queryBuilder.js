/**
 * Query Builder compatível com sintaxe Knex para MySQL2
 * Oferece interface similar ao Knex mas usa mysql2 por baixo
 */

const db = require('./database');
const logger = require('./logger');
const projecoes = require('./projecoes');
const tabelasInternas = { sync_pendente: ['id', 'dispositivo_id', 'pessoa_id', 'last_attempt'] };

function colunasPermitidas(tabela) {
  const declaracao = projecoes[tabela];
  if (declaracao) return new Set([...declaracao.leitura, ...declaracao.escrita, ...declaracao.segredo]);
  if (tabelasInternas[tabela]) return new Set(tabelasInternas[tabela]);
  throw new Error(`QUERY_IDENTIFICADOR_INVALIDO: tabela ${tabela}`);
}

function inteiroSeguro(valor, nome) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) throw new Error(`QUERY_LIMITE_INVALIDO: ${nome}`);
  return numero;
}

class QueryBuilder {
  constructor(table = null) {
    this.table = table;
    this.columns = ['*'];
    this.wheres = [];
    this.joins = [];
    this.orderBys = [];
    this.limits = null;
    this.offsets = null;
    this.values = [];
  }

  // SELECT
  select(cols = ['*']) {
    if (Array.isArray(cols)) {
      this.columns = cols;
    } else {
      this.columns = Array.from(arguments);
    }
    return this;
  }

  // FROM (setter de tabela)
  from(table) {
    this.table = table;
    return this;
  }

  // WHERE
  where(column, operator = '=', value = null) {
    // Suportar where(column, value) e where(column, operator, value)
    if (value === null && operator !== '=' && operator !== '!=' && operator !== '>' && operator !== '<' && operator !== '>=' && operator !== '<=') {
      value = operator;
      operator = '=';
    }
    this.wheres.push({ type: 'where', column, operator, value });
    return this;
  }

  whereRaw(sql, bindings = []) {
    this.wheres.push({ type: 'raw', sql, bindings });
    return this;
  }

  // ORDER BY
  orderBy(column, direction = 'asc') {
    this.orderBys.push({ column, direction });
    return this;
  }

  // LIMIT
  limit(num) {
    this.limits = num;
    return this;
  }

  // OFFSET
  offset(num) {
    this.offsets = num;
    return this;
  }

  // BUILD QUERY
  buildQuery() {
    if (!this.table) throw new Error('Tabela não especificada');

    const colunas = colunasPermitidas(this.table);
    for (const coluna of this.columns) {
      if (coluna === '*' || colunas.has(coluna)) continue;
      const agregado = /^COUNT\((\*|[A-Za-z_][A-Za-z0-9_]*)\)(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?$/i.exec(coluna);
      if (!agregado || (agregado[1] !== '*' && !colunas.has(agregado[1]))) {
        throw new Error(`QUERY_IDENTIFICADOR_INVALIDO: coluna ${coluna}`);
      }
    }
    for (const where of this.wheres) {
      if (where.type !== 'raw' && !colunas.has(where.column)) {
        throw new Error(`QUERY_IDENTIFICADOR_INVALIDO: coluna ${where.column}`);
      }
    }
    for (const order of this.orderBys) {
      if (!colunas.has(order.column)) throw new Error(`QUERY_ORDER_BY_INVALIDO: coluna ${order.column}`);
      if (typeof order.direction !== 'string' || !['ASC', 'DESC'].includes(order.direction.toUpperCase())) {
        throw new Error(`QUERY_ORDER_BY_INVALIDO: direcao ${order.direction}`);
      }
      order.direction = order.direction.toUpperCase();
    }
    let sql = `SELECT ${this.columns.join(', ')} FROM ${this.table}`;
    let bindings = [];

    // WHERE
    if (this.wheres.length > 0) {
      const whereParts = [];
      this.wheres.forEach(w => {
        if (w.type === 'raw') {
          whereParts.push(w.sql);
          bindings.push(...(w.bindings || []));
        } else {
          whereParts.push(`${w.column} ${w.operator} ?`);
          bindings.push(w.value);
        }
      });
      sql += ` WHERE ${whereParts.join(' AND ')}`;
    }

    // ORDER BY
    if (this.orderBys.length > 0) {
      sql += ` ORDER BY ${this.orderBys.map(o => `${o.column} ${o.direction}`).join(', ')}`;
    }

    // LIMIT
    if (this.limits !== null) {
      sql += ` LIMIT ${inteiroSeguro(this.limits, 'LIMIT')}`;
    }

    // OFFSET
    if (this.offsets !== null) {
      sql += ` OFFSET ${inteiroSeguro(this.offsets, 'OFFSET')}`;
    }

    return { sql, bindings };
  }

  // PRIMEIRO
  async first(columns = ['*']) {
    if (columns.length > 0) {
      this.columns = columns;
    }
    this.limit(1);
    const { sql, bindings } = this.buildQuery();
    
    try {
      const [rows] = await db.query(sql, bindings);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      logger.error(`Erro na query: ${sql}`);
      throw error;
    }
  }

  // TODOS
  async get(columns = ['*']) {
    if (columns.length > 0) {
      this.columns = columns;
    }
    const { sql, bindings } = this.buildQuery();
    
    try {
      const [rows] = await db.query(sql, bindings);
      return rows;
    } catch (error) {
      logger.error(`Erro na query: ${sql}`);
      throw error;
    }
  }

  // INSERT
  async insert(data) {
    if (!this.table) throw new Error('Tabela não especificada');
    if (Array.isArray(data)) {
      return this.insertMultiple(data);
    }

    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${this.table} (${columns.join(', ')}) VALUES (${placeholders})`;

    try {
      const [result] = await db.query(sql, values);
      return result.insertId;
    } catch (error) {
      logger.error(`Erro na query INSERT: ${sql}`);
      throw error;
    }
  }

  async insertMultiple(dataArray) {
    if (dataArray.length === 0) return [];
    
    const columns = Object.keys(dataArray[0]);
    const placeholders = dataArray.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const values = dataArray.flatMap(d => columns.map(col => d[col]));
    const sql = `INSERT INTO ${this.table} (${columns.join(', ')}) VALUES ${placeholders}`;

    try {
      const [result] = await db.query(sql, values);
      return result.insertId;
    } catch (error) {
      logger.error(`Erro na query INSERT MULTIPLE: ${sql}`);
      throw error;
    }
  }

  // UPDATE
  async update(data) {
    if (!this.table) throw new Error('Tabela não especificada');
    if (this.wheres.length === 0) throw new Error('UPDATE sem WHERE é perigoso, use whereRaw se necessário');

    const columns = Object.keys(data);
    const setParts = columns.map(col => `${col} = ?`);
    const values = Object.values(data);

    let sql = `UPDATE ${this.table} SET ${setParts.join(', ')}`;
    let bindings = [...values];

    // WHERE
    if (this.wheres.length > 0) {
      const whereParts = [];
      this.wheres.forEach(w => {
        if (w.type === 'raw') {
          whereParts.push(w.sql);
          bindings.push(...(w.bindings || []));
        } else {
          whereParts.push(`${w.column} ${w.operator} ?`);
          bindings.push(w.value);
        }
      });
      sql += ` WHERE ${whereParts.join(' AND ')}`;
    }

    try {
      const [result] = await db.query(sql, bindings);
      return result.affectedRows;
    } catch (error) {
      logger.error(`Erro na query UPDATE: ${sql}`);
      throw error;
    }
  }

  // INCREMENT
  async increment(column, value = 1) {
    if (!this.table) throw new Error('Tabela não especificada');
    if (this.wheres.length === 0) throw new Error('INCREMENT sem WHERE é perigoso');

    let sql = `UPDATE ${this.table} SET ${column} = ${column} + ?`;
    let bindings = [value];

    if (this.wheres.length > 0) {
      const whereParts = [];
      this.wheres.forEach(w => {
        if (w.type === 'raw') {
          whereParts.push(w.sql);
          bindings.push(...(w.bindings || []));
        } else {
          whereParts.push(`${w.column} ${w.operator} ?`);
          bindings.push(w.value);
        }
      });
      sql += ` WHERE ${whereParts.join(' AND ')}`;
    }

    try {
      const [result] = await db.query(sql, bindings);
      return result.affectedRows;
    } catch (error) {
      logger.error(`Erro na query INCREMENT: ${sql}`);
      throw error;
    }
  }

  // DELETE
  async del() {
    if (!this.table) throw new Error('Tabela não especificada');
    if (this.wheres.length === 0) throw new Error('DELETE sem WHERE é perigoso, use whereRaw se necessário');

    let sql = `DELETE FROM ${this.table}`;
    let bindings = [];

    if (this.wheres.length > 0) {
      const whereParts = [];
      this.wheres.forEach(w => {
        if (w.type === 'raw') {
          whereParts.push(w.sql);
          bindings.push(...(w.bindings || []));
        } else {
          whereParts.push(`${w.column} ${w.operator} ?`);
          bindings.push(w.value);
        }
      });
      sql += ` WHERE ${whereParts.join(' AND ')}`;
    }

    try {
      const [result] = await db.query(sql, bindings);
      return result.affectedRows;
    } catch (error) {
      logger.error(`Erro na query DELETE: ${sql}`);
      throw error;
    }
  }

  // CONTAR
  async count(column = '*') {
    const originalColumns = this.columns;
    this.columns = [`COUNT(${column}) as count`];
    const result = await this.first();
    this.columns = originalColumns;
    return result ? result.count : 0;
  }

  // RAW QUERY
  async raw(sql, bindings = []) {
    try {
      const [rows, fields] = await db.query(sql, bindings);
      return [rows, fields];
    } catch (error) {
      logger.error(`Erro na query RAW: ${sql}`);
      throw error;
    }
  }
}

// Global DB wrapper que suporta tanto Knex syntax quanto mysql2
const globalDB = (table = null) => {
  if (!table) {
    // Se chamado sem tabela, retorna apenas query raw
    return {
      query: (sql, bindings) => db.query(sql, bindings),
      raw: (sql, bindings) => db.query(sql, bindings)
    };
  }
  return new QueryBuilder(table);
};

module.exports = { globalDB, db };
