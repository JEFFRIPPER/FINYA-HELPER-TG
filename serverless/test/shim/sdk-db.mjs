// Minimal stand-in for the platform's `sdk/db`: raw SQL over node:sqlite plus
// enough of the schema DSL to create the tables from tgcloud/schema.js.
import { DatabaseSync } from 'node:sqlite';

class Sql {
  constructor(strings, values) {
    this.strings = strings;
    this.values = values;
  }

  compile(out = { text: '', params: [] }) {
    this.strings.forEach((s, i) => {
      out.text += s;
      if (i < this.values.length) {
        const v = this.values[i];
        if (v instanceof Sql) v.compile(out);
        else if (v instanceof Raw) out.text += v.text;
        else {
          if (v === undefined) throw new Error('undefined SQL parameter');
          if (typeof v === 'boolean') throw new Error('boolean SQL parameter');
          out.text += '?';
          out.params.push(v);
        }
      }
    });
    return out;
  }
}

class Raw {
  constructor(text) {
    this.text = text;
  }
}

export function sql(strings, ...values) {
  return new Sql(strings, values);
}
sql.raw = (text) => new Raw(text);

let database = null;

function conn() {
  if (!database) throw new Error('test DB not initialised: call resetDb()');
  return database;
}

function compile(q, params) {
  if (q instanceof Sql) return q.compile();
  return { text: q, params: params || [] };
}

export const db = {
  async run(q, params) {
    const { text, params: p } = compile(q, params);
    const stmt = conn().prepare(text);
    if (/\breturning\b/i.test(text)) {
      const rows = stmt.all(...p);
      return { rowsAffected: rows.length, lastInsertRowid: 0, rows };
    }
    const r = stmt.run(...p);
    return { rowsAffected: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid), rows: [] };
  },
  async all(q, params) {
    const { text, params: p } = compile(q, params);
    return conn().prepare(text).all(...p).map((r) => ({ ...r }));
  },
  async get(q, params) {
    const { text, params: p } = compile(q, params);
    const r = conn().prepare(text).get(...p);
    return r ? { ...r } : null;
  },
  async values(q, params) {
    const rows = await this.all(q, params);
    return rows.map((r) => Object.values(r));
  },
};
export default db;

// ---- schema DSL ------------------------------------------------------------

class Column {
  constructor(type, name) {
    this.type = type;
    this.name = name;
    this.parts = [];
  }
  primaryKey(opts = {}) { this.parts.push(opts.autoIncrement ? 'PRIMARY KEY AUTOINCREMENT' : 'PRIMARY KEY'); return this; }
  notNull() { this.parts.push('NOT NULL'); return this; }
  unique() { this.parts.push('UNIQUE'); return this; }
  default(v) { this.parts.push(`DEFAULT ${typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v}`); return this; }
  ddl() { return [this.name, this.type, ...this.parts].join(' '); }
}

const col = (type) => (name) => new Column(type, name);
export const integer = col('INTEGER');
export const text = col('TEXT');
export const real = col('REAL');

export function index(name) {
  return { on: (...cols) => ({ kind: 'index', name, cols }) };
}
export function primaryKey({ columns }) {
  return { kind: 'pk', cols: columns };
}

export function table(name, columns, extra) {
  for (const [key, c] of Object.entries(columns)) if (!c.name) c.name = key;
  const constraints = extra ? Object.values(extra(columns)) : [];
  const defs = Object.values(columns).map((c) => c.ddl());
  for (const c of constraints) if (c.kind === 'pk') defs.push(`PRIMARY KEY (${c.cols.map((x) => x.name).join(', ')})`);
  const statements = [`CREATE TABLE ${name} (${defs.join(', ')})`];
  for (const c of constraints) {
    if (c.kind === 'index') statements.push(`CREATE INDEX ${c.name} ON ${name} (${c.cols.map((x) => x.name).join(', ')})`);
  }
  return { __table: name, statements };
}

export async function resetDb(schema) {
  if (database) database.close();
  database = new DatabaseSync(':memory:');
  for (const t of Object.values(schema)) {
    if (t && t.__table) for (const s of t.statements) database.exec(s);
  }
}
