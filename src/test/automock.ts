/**
 * Shared NestJS test mocker.
 *
 * Auto-generated `*.spec.ts` files only declare the unit under test in
 * `providers`, so Nest can't resolve its real dependencies (Redis client,
 * Knex connection, Mailer, sibling services, ...). Passing this to
 * `Test.createTestingModule(...).useMocker(autoMocker)` returns a generic mock
 * for every otherwise-unresolved dependency.
 *
 * The Proxy returns a `jest.fn()` for any accessed property, but deliberately
 * returns `undefined` for `then` and for symbol keys — otherwise the mock looks
 * like a thenable and Nest's async `compile()` awaits it forever (timeout).
 */
export const autoMocker = () =>
  new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'then' || typeof prop === 'symbol' ? undefined : jest.fn(),
    },
  );
