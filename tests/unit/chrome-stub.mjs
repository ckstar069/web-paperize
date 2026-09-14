// Side-effect import: some background modules wire chrome APIs at module
// level (settings.js storage listener). Import this first in tests that
// import them under node --test.
globalThis.chrome = globalThis.chrome || {
  storage: {
    onChanged: { addListener() {} },
    local: { get: async () => ({}), set: async () => {} },
  },
};
