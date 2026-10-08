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

export class EndpointError extends Error {}

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

export async function fetch() {
  throw new Error('fetch is not available in tests');
}
