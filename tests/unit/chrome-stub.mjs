// Some background modules wire chrome APIs at module level. This deterministic
// storage double also exposes controls for schema and transaction tests.
const listeners = [];
const localData = {};
let setFailure = null;

const emit = (changes, area = 'local') => {
  for (const listener of listeners) listener(changes, area);
};

export const chromeTest = {
  localData,
  replaceDefaults(value) {
    const oldValue = localData.defaults;
    localData.defaults = value;
    emit({ defaults: { oldValue, newValue: value } });
  },
  rejectNextSet(error = new Error('synthetic storage failure')) {
    setFailure = error;
  },
};

globalThis.chrome = {
  storage: {
    onChanged: { addListener(listener) { listeners.push(listener); } },
    local: {
      async get(defaults = {}) {
        const out = {};
        for (const [key, fallback] of Object.entries(defaults)) {
          out[key] = Object.hasOwn(localData, key) ? localData[key] : fallback;
        }
        return out;
      },
      async set(values) {
        if (setFailure) {
          const error = setFailure;
          setFailure = null;
          throw error;
        }
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          changes[key] = { oldValue: localData[key], newValue: value };
          localData[key] = value;
        }
        emit(changes);
      },
    },
  },
};
