// Maps the platform's `sdk` imports to the local test double.
const MAP = {
  sdk: new URL('./sdk.mjs', import.meta.url).href,
  'sdk/db': new URL('./sdk-db.mjs', import.meta.url).href,
  'sdk/api': new URL('./sdk.mjs', import.meta.url).href,
};

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  return next(specifier, context);
}
