// Minimal stand-in for the platform's `sdk`: db plus a scriptable Bot API.
import { db } from './sdk-db.mjs';

export { db };

export class BotApiError extends Error {
  constructor(method, code, description, parameters) {
    super(description);
    this.method = method;
    this.code = code;
    this.description = description;
    this.parameters = parameters;
  }
}

export class EndpointError extends Error {
  constructor(description, parameters) {
    super(description);
    this.description = description;
    this.parameters = parameters;
  }
}

export class InputFile {
  constructor(bytes, filename, opts = {}) {
    this.bytes = bytes;
    this.filename = filename;
    this.type = opts.type;
  }
}

// Tests set `apiMock.handler(method, params)`; every call is recorded.
export const apiMock = {
  calls: [],
  handler: async () => true,
  reset() {
    this.calls = [];
    this.handler = async () => true;
  },
  called(method) {
    return this.calls.filter((c) => c.method === method);
  },
};

export const api = new Proxy({}, {
  get(_, method) {
    if (method === 'then') return undefined;
    return async (params = {}) => {
      apiMock.calls.push({ method, params });
      return apiMock.handler(method, params);
    };
  },
});

// Tests set `fetchMock.handler(url, opts)` and return { status, json }.
export const fetchMock = {
  calls: [],
  handler: null,
  reset() {
    this.calls = [];
    this.handler = null;
  },
};

export async function fetch(url, opts = {}) {
  fetchMock.calls.push({ url, opts });
  if (!fetchMock.handler) throw new Error('fetch is not available in tests');
  const r = await fetchMock.handler(url, opts);
  const status = r.status ?? 200;
  return {
    status, ok: status >= 200 && status < 300, url,
    async json() { if (r.json === undefined) throw new SyntaxError('no body'); return r.json; },
    async text() { return JSON.stringify(r.json ?? ''); },
  };
}
fetch.body = {
  form: (o) => ({ form: o }),
  json: (o) => ({ json: o }),
  text: (t) => ({ text: t }),
};
