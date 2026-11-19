import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { UserRoleTypes } from '../../../user/domain';
import { PUBLIC_METADATA_KEY } from '../public.decorator';
import { ROLES_METADATA_KEY } from '../roles.decorator';
import { requiredRoles, rolesAdmit } from '../roles.guard';

/**
 * For specs only: every HTTP route the application registers, read the way
 * Nest and the guards read it (CLEAN-232).
 *
 * Not a scan of source text. The table is built from the module graph of
 * `AppModule`: every module it imports, every controller those declare, and
 * each handler's own metadata. So it sees the controllers `McpModule.forRoot`
 * builds at boot, it cannot be fooled by a comment between two decorators,
 * and a controller nobody registered is not in it. `api/scripts/audit-routes.mjs`
 * prints the same table from source for a person to read; the two must agree.
 */
export interface IRouteRow {
  /** `GET /agents/:id` */
  route: string;
  controller: string;
  handler: string;
  isPublic: boolean;
  /** What `@Roles` states on the handler, else the class; undefined for none. */
  statedRoles: UserRoleTypes[] | undefined;
  /** What RolesGuard asks for: the stated roles, else the Admin default. */
  roles: readonly UserRoleTypes[];
  /** Names of the guards attached with `@UseGuards`, class first. */
  guards: string[];
  /** Read a route's own metadata, the handler's first and then the class's. */
  metadata: <T>(key: string) => T | undefined;
  /** The handler and the class, as an ExecutionContext hands them to a guard. */
  targets: { handler: (...args: unknown[]) => unknown; controller: object };
}

type Ctor = abstract new (...args: never[]) => unknown;

function isCtor(value: unknown): value is Ctor {
  return typeof value === 'function';
}

/** A module as `imports` holds it: a class, a dynamic module, a forward ref. */
function unwrapModule(entry: unknown): {
  /** The class, or the dynamic module object, behind a forward ref if any. */
  resolved: unknown;
  imports: unknown[];
  controllers: unknown[];
} {
  let value: unknown = entry;
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { forwardRef?: unknown }).forwardRef === 'function'
  ) {
    value = (value as { forwardRef: () => unknown }).forwardRef();
  }
  const dynamic =
    typeof value === 'object' && value !== null
      ? (value as {
          module?: unknown;
          imports?: unknown;
          controllers?: unknown;
        })
      : undefined;
  const module = dynamic
    ? isCtor(dynamic.module)
      ? dynamic.module
      : undefined
    : isCtor(value)
      ? value
      : undefined;
  const fromDecorator = (key: string): unknown[] => {
    const found: unknown = module
      ? Reflect.getMetadata(key, module)
      : undefined;
    return Array.isArray(found) ? found : [];
  };
  return {
    resolved: value,
    imports: [
      ...fromDecorator('imports'),
      ...(Array.isArray(dynamic?.imports) ? dynamic.imports : []),
    ],
    controllers: [
      ...fromDecorator('controllers'),
      ...(Array.isArray(dynamic?.controllers) ? dynamic.controllers : []),
    ],
  };
}

/** Every controller class reachable from `root`, each once. */
export function controllersOf(root: unknown): Ctor[] {
  const seenModules = new Set<unknown>();
  const controllers = new Set<Ctor>();
  const walk = (entry: unknown): void => {
    const { resolved, imports, controllers: declared } = unwrapModule(entry);
    // Each module is walked once: a class by itself, a dynamic module by the
    // object `forRoot` returned, since two calls may carry different
    // controllers. Modules import each other in cycles.
    if (seenModules.has(resolved)) return;
    seenModules.add(resolved);
    for (const controller of declared) {
      if (isCtor(controller)) controllers.add(controller);
    }
    for (const imported of imports) walk(imported);
  };
  walk(root);
  return [...controllers];
}

function joinPath(prefix: string, path: string): string {
  const joined = [prefix, path]
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/');
  return `/${joined}`;
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [typeof value === 'string' ? value : ''];
}

/** The routes of these controllers, sorted by route then controller. */
export function routesOf(controllers: Ctor[]): IRouteRow[] {
  const rows: IRouteRow[] = [];
  for (const controller of controllers) {
    const prefixes = asList(Reflect.getMetadata(PATH_METADATA, controller));
    const proto = controller.prototype as object;
    // Own and inherited handlers alike, as Nest's own scanner collects them.
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    for (
      let p: object | null = proto;
      p && p !== Object.prototype;
      p = Object.getPrototypeOf(p) as object | null
    ) {
      for (const name of Object.getOwnPropertyNames(p)) {
        if (name === 'constructor' || handlers.has(name)) continue;
        // Descriptors, not property reads: a getter must not run here.
        const value: unknown = Object.getOwnPropertyDescriptor(p, name)?.value;
        if (typeof value === 'function') {
          handlers.set(name, value as (...args: unknown[]) => unknown);
        }
      }
    }
    for (const [name, handler] of handlers) {
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined;
      if (method === undefined) continue;
      const paths = asList(Reflect.getMetadata(PATH_METADATA, handler));
      const metadata = <T>(key: string): T | undefined => {
        const own = Reflect.getMetadata(key, handler) as T | undefined;
        return own !== undefined
          ? own
          : (Reflect.getMetadata(key, controller) as T | undefined);
      };
      const guardNames = (holder: object): string[] => {
        const found: unknown = Reflect.getMetadata(GUARDS_METADATA, holder);
        return Array.isArray(found)
          ? found.map((g) => (g as { name?: string }).name ?? String(g))
          : [];
      };
      const statedRoles = metadata<UserRoleTypes[]>(ROLES_METADATA_KEY);
      for (const prefix of prefixes) {
        for (const path of paths) {
          rows.push({
            route: `${RequestMethod[method]} ${joinPath(prefix, path)}`,
            controller: controller.name,
            handler: name,
            isPublic: metadata<boolean>(PUBLIC_METADATA_KEY) === true,
            statedRoles,
            roles: requiredRoles(statedRoles),
            guards: [...guardNames(controller), ...guardNames(handler)],
            metadata,
            targets: { handler, controller },
          });
        }
      }
    }
  }
  return rows.sort(
    (a, b) =>
      a.route.localeCompare(b.route) ||
      a.controller.localeCompare(b.controller),
  );
}

/** Whether a bearer holding exactly this role passes the route's role check. */
export function admits(row: IRouteRow, role: UserRoleTypes): boolean {
  return !row.isPublic && rolesAdmit(row.roles, [role]);
}

function appModule(): object {
  // Required late, so a spec's jest.mock calls are in place first.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return (require('../../../../../app.module') as { AppModule: object })
    .AppModule;
}

let cached: IRouteRow[] | undefined;

/**
 * The routes of the real application. Loads `AppModule` once per spec file;
 * a spec that calls this must mock `@kubernetes/client-node` first (it is an
 * ES module jest cannot load), as toolAudience.spec.ts does.
 */
export function appRoutes(): IRouteRow[] {
  cached ??= routesOf(controllersOf(appModule()));
  return cached;
}

/** The guards `AppModule` registers globally, in order, by class name. */
export function appGlobalGuards(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { APP_GUARD } = require('@nestjs/core') as { APP_GUARD: string };
  const providers: unknown = Reflect.getMetadata('providers', appModule());
  return (Array.isArray(providers) ? providers : [])
    .filter(
      (p): p is { provide: unknown; useClass: { name: string } } =>
        typeof p === 'object' &&
        p !== null &&
        (p as { provide?: unknown }).provide === APP_GUARD,
    )
    .map((p) => p.useClass.name);
}
