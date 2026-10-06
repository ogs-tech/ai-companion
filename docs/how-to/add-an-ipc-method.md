---
title: Add an IPC method
description: Contributor guide — add a main-process use case and expose it to the renderer over the single ipc:call channel.
---

# Add an IPC method

> **Audience:** contributors. Background: [Architecture](../reference/architecture.md) (hexagonal layers)
> and [IPC contract](../reference/ipc-contract.md) (wire shape, error mapping).

Running example: a read-only `launchConfig.list`. Every step has a real counterpart in the code — follow
`launch-config-*` files to see a finished one.

## 1. Define the types in `src/shared/`

Params and result types live in the shared module of their area (`src/shared/launch-config.ts`,
`src/shared/git.ts`, …), or in `src/shared/ipc-contract.ts` for small cross-cutting ones. Both processes
import them; they must stay free of Node and DOM APIs.

## 2. Implement the use case in a service

Add the method to the service in `src/main/application/services/` that owns the use case. The service
depends on **ports** (`src/main/application/ports/`) only — never on `node:fs`, `electron`, `simple-git` or
`@octokit/rest` directly. If you need new I/O, add a port and its implementation under
`src/main/infrastructure/`, and wire the implementation in the composition root.

Report expected failures with `DomainError(kind, message, details?)` (`src/main/domain/errors.ts`). The
`kind` reaches the renderer verbatim as `IpcError.kind` — pick from `IpcErrorKind` in
`src/shared/ipc-contract.ts` (`validation`, `not_found`, `conflict`, `io`, `auth`, …). A plain `Error`
becomes `kind: 'internal'` and loses its details.

## 3. Add the handler

Handlers are grouped per namespace in `src/main/ipc/<namespace>-handlers.ts`, each exporting a
`build<Namespace>Handlers(...)` that returns an `IpcHandlers` map:

```ts
export function buildLaunchConfigHandlers(
  configService: LaunchConfigService,
  processService: LaunchProcessService,
): IpcHandlers {
  return {
    'launchConfig.list': async () => configService.listAll(),
    'launchConfig.run': async (params) => {
      const raw = asObject(params, 'launchConfig.run');
      return processService.run(asString(raw['projectId'], 'projectId'), asString(raw['configName'], 'configName'));
    },
  };
}
```

- **Validate every raw param** with the helpers in `src/main/ipc/_validators.ts` (`asObject`, `asString`,
  `asOptString`, `asBoolean`, `asStringArray`, `asScope`, …). Params arrive as `unknown` from an untrusted
  renderer; the helpers throw `validation` errors with a consistent message.
- Keep the handler thin: validate, delegate, return. No business logic.

**New namespace?** Also:

1. add the service(s) to `IpcDeps` and spread `...build<Namespace>Handlers(...)` into `buildHandlers`
   in `src/main/ipc/registry.ts`;
2. pass the dependency from `buildDeps()` in `src/main/index.ts`.

If the service is per-workspace (built in `src/main/application/workspace-scoped-services.ts`), read it from
`workspaceScoped` inside `buildDeps()`. The dispatcher is rebuilt from `buildDeps()` on every
`workspace.switchTo`, so the handler always closes over the active workspace's graph.

## 4. Test the handler

Add `tests/main/ipc/<namespace>-handlers.test.ts`: build the handlers over a mocked service and assert
(a) valid params are delegated, (b) missing/invalid params reject with `validation`. See
`tests/main/ipc/launch-config-handlers.test.ts`. Test the use case itself at the service level, against
in-memory or fake ports (`src/main/application/services/__fixtures__/`).

## 5. Call it from the renderer

Wrap the call in a react-query hook under `src/renderer/hooks/`:

```ts
export const launchConfigsQueryKey = ['launchConfigs'] as const;

export function useLaunchConfigs(): UseQueryResult<ProjectLaunchConfigs[]> {
  return useQuery<ProjectLaunchConfigs[]>({
    queryKey: launchConfigsQueryKey,
    queryFn: () => callIpc<ProjectLaunchConfigs[]>('launchConfig.list'),
  });
}
```

`callIpc` (`src/renderer/lib/ipc.ts`) unwraps `IpcResult<T>` and throws `IpcCallError` (with `kind`) on
failure. Mutations use `useMutation` and invalidate the affected query keys on success.

No preload change is needed: the preload bridge exposes one generic `call(method, params)` over the single
`ipc:call` channel. Only **push** channels (main → renderer streams, like `session:output`) need a preload
addition — see [IPC contract → Push channels](../reference/ipc-contract.md#push-channels-exception-to-requestresponse).

## 6. Document it

Add a row to the namespace's table in [IPC contract](../reference/ipc-contract.md), with its error
conditions. Then run the release gate:

```bash
npm run lint && npm run typecheck && npm test
```
