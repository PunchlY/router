import { inject, registerInjectable } from './service';
import { bucket } from './util';

const WebSocketHook = ['upgrade', 'open', 'message', 'drain', 'close', 'ping', 'pong'] as const;
const BeforHandleHook = ['request', 'parse', 'beforeHandle'] as const;
const AfterHandleHook = ['afterHandle', 'mapResponse', 'afterResponse'] as const;
const HookType = [...BeforHandleHook, ...AfterHandleHook] as const;
type HookType = typeof HookType[number];

interface Init {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
}
interface Use {
    readonly controller: Controller;
    readonly init?: Init;
}
interface Route<Type extends 'Generator' | 'Function' | 'Accessor' | 'Static'> {
    readonly type: Type;
    readonly controller: Controller;
    readonly propertyKey: string | symbol;
    readonly init?: Init,
    use: Use[];
}
interface Handler extends Route<'Generator' | 'Function' | 'Accessor'> {
}
interface Static extends Route<'Static'> {
}
interface Hook {
    readonly controller: Controller;
    readonly propertyKey: string | symbol;
}

const $ALL = Symbol('ALL');
class Controller {
    static #list = new WeakMap<Function, Controller>();
    static from = bucket(this.#list, (target: Function) => new Controller(target));
    static isController(controller: Function) {
        if (typeof controller === 'function' && this.#list.has(controller)) {
            if (this.#list.get(controller)!.global)
                return true;
        }
        return false;
    }

    private constructor(readonly target: Function) {
        if (typeof target !== 'function')
            throw new TypeError();
    }

    global?: {
        prefix?: string,
        init?: Init;
    };
    init(opt: Controller['global'] & {}) {
        if (this.global)
            throw new Error('Controller has been initialized');
        registerInjectable(this.target, true);
        this.global = opt;
    }

    readonly #hookList: Map<HookType, Hook[]> = new Map();

    static *hooks(use: Use[], name: HookType) {
        if (!AfterHandleHook.includes(name as typeof AfterHandleHook[number]))
            use = use.toReversed();
        for (const { controller } of use) {
            if (!controller.#hookList.has(name))
                continue;
            yield* controller.#hookList.get(name)!;
        }
    }

    #routes = new Map<string, Map<Uppercase<string> | typeof $ALL, Handler> | Static>();

    set(path: string, method: Uppercase<string> | typeof $ALL = $ALL, value: Handler | Static) {
        if (value.type === 'Static') {
            if (this.#routes.has(path))
                throw new Error('Route already exists for this method');
            this.#routes.set(path, value);
            return;
        }
        let route = this.#routes.get(path);
        if (this.#routes.has(path)) {
            if (route instanceof Map) {
                if (route.has(method))
                    throw new Error('Route already exists for this method');
            } else {
                throw new Error('Route already exists for this method');
            }
        } else {
            this.#routes.set(path, route = new Map());
        }
        route.set(method, value);
    }

    *routes() {
        if (!this.global)
            throw new Error('Cannot use a disabled controller');
        const prefix = String(this.global.prefix ?? '/').replaceAll(/^(?!\/)|(?<!\/)$/g, '/').replaceAll('$', '$$$$') as '/' | `/${string}/`;
        for (const [path, handlers] of this.#routes.entries())
            yield [path.replace(/^\/?/, prefix) as `/${string}`, handlers] as const;
    }

    *values() {
        for (const route of this.#routes.values()) {
            if (route instanceof Map)
                yield* route.values();
            else
                yield route;
        }
    }

    *entries() {
        for (const [path, route] of this.routes()) {
            if (route instanceof Map)
                for (const [method, handler] of route) {
                    yield [path, method, handler] as const;
                }
            else
                yield [path, undefined, route] as const;
        }
    }

    use({ router }: {
        router: Function;
    }) {
        if (!Controller.isController(router))
            throw new Error('Cannot use a disabled controller');
        const controller = Controller.from(router);
        for (const [name, hook] of this.#hookList) {
            let hooks = this.#hookList.get(name);
            if (!hooks)
                this.#hookList.set(name, hooks = []);
            hooks.push(...hook);
        }
        for (const handler of this.values())
            handler.use = [...handler.use, { controller }];
        for (const [path, method, handler] of controller.entries())
            this.set(path, method, handler);
    }

    mount({ path, propertyKey, init }: {
        path: string;
        propertyKey: string | symbol;
        init?: Init;
    }) {
        const router = inject(this.target.prototype, propertyKey);
        if (!Controller.isController(router))
            throw new Error('Cannot use a disabled controller');
        const controller = Controller.from(router);
        path = path.replace(/^\/?/, '/');
        const prefix = path.replace(/^(?!\/)|(?<!\/)$/g, '/').replaceAll('$', '$$$$');
        for (const [path, method, handler] of controller.entries())
            this.set(path.replace(/^\/?/, prefix), method, {
                ...handler,
                use: [...handler.use, { controller: this, init }],
            });
    }

    route({ path, method, propertyKey, init, type }: {
        path: string;
        propertyKey: string | symbol;
        method?: Uppercase<string>;
        type: (Handler | Static)['type'],
        init?: Init;
    }) {
        this.set(path.replace(/^\/?/, '/'), method, {
            controller: this,
            type,
            propertyKey,
            init,
            use: [{ controller: this }],
        });
    }

    hook({ hook: name, propertyKey }: {
        hook: HookType;
        propertyKey: string | symbol;
    }) {
        if (!HookType.includes(name))
            throw new Error(`Invalid hook: ${name}`);
        let hooks = this.#hookList.get(name);
        if (!hooks)
            this.#hookList.set(name, hooks = []);
        hooks.push({ controller: this, propertyKey });
    }
}

export type { Init, Handler, Static, Hook };
export { Controller, HookType, $ALL };
