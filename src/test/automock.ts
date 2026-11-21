export const autoMocker = () =>
  new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'then' || typeof prop === 'symbol' ? undefined : jest.fn(),
    },
  );
