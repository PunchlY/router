import type { HeadersInit } from 'bun';
import { instanceBucket } from './bucket';
import { construct, getType } from './service';

const RequestLifecycleHook = ['beforeHandle', 'mapResponse', 'afterHandle'] as const;
type RequestLifecycleHook = typeof RequestLifecycleHook[number];

type HTTPMethod = import('bun').RouterTypes.HTTPMethod;

interface Handler {
    type: 'Generator' | 'Function',
    controller: Controller;
    propertyKey: string | symbol;
    init: {
        headers?: Record<string, string>;
        status?: number;
        statusText?: string;
    };
}
interface Static {
    type: 'Static';
    controller: Controller;
    propertyKey: string | symbol;
    init: {
        headers?: Record<string, string>;
        status?: number;
        statusText?: string;
    };
}

class Controller {
    constructor(public readonly target: Function) {
        if (typeof target !== 'function')
            throw new TypeError();
    }

    readonly injectList = new Map<string | symbol, Function>();
    inject(propertyKey: string | symbol) {
        const type = getType(this.target.prototype, propertyKey);
        if (typeof type !== 'function')
            throw new TypeError();
        this.injectList.set(propertyKey, type);
    }

    #prefix?: '/' | `/${string}/`;
    init({ prefix }: { prefix: string; }) {
        if (typeof this.#prefix === 'string')
            throw new Error('Prefix has already been set');
        if (typeof prefix !== 'string')
            throw new TypeError();
        this.#prefix = prefix.replaceAll(/^(?!\/)|(?<!\/)$/g, '/').replaceAll('$', '$$$$') as '/' | `/${string}/`;
        for (const [propertyKey, type] of this.injectList) {
            Reflect.defineProperty(this.target.prototype, propertyKey, {
                value: construct(type),
            });
        }
    }

    #use: Set<Controller> = new Set();

    readonly hooks: Map<RequestLifecycleHook, Handler[]> = new Map();
    readonly #routes: Map<string, Map<HTTPMethod, Handler | Static> | Handler | Static> = new Map();

    *handlers() {
        if (!this.#prefix)
            throw new Error('Cannot use a disabled controller');
        for (const [path, handlers] of this.#routes) {
            yield [path.replace(/^\/?/, this.#prefix) as `/${string}`, handlers] as const;
        }
    }

    #route(path: string) {
        let route: Map<HTTPMethod, Handler | Static> | Handler | Static;
        if (this.#routes.has(path)) {
            route = this.#routes.get(path)!;
            if (!(route instanceof Map))
                throw new Error('Route already exists for this path');
        } else {
            this.#routes.set(path, route = new Map());
        }
        return route;
    }

    use(router: Controller) {
        if (!(router instanceof Controller))
            throw new TypeError();
        if (!router.#prefix)
            throw new Error('Cannot use a disabled controller');
        if (this.#use.has(router))
            throw new Error('Controller is already in use');
        this.#use.add(router);
        this.#use = this.#use.union(router.#use);
        for (const [type, handler] of router.hooks) {
            let hooks = this.hooks.get(type);
            if (!hooks)
                this.hooks.set(type, hooks = []);
            hooks.push(...handler);
        }
        this.mountController('/', router);
    }
    mountController(path: string, router: Controller) {
        if (!(router instanceof Controller))
            throw new TypeError();
        path = path.replace(/^\/?/, '/');
        if (!router.#prefix)
            throw new Error('Cannot mount a disabled controller');
        const prefix = path.replace(/^(?!\/)|(?<!\/)$/g, '/').replaceAll('$', '$$$$');
        for (let [path, handler] of router.handlers()) {
            path = path.replace(/^\/?/, prefix) as `/${string}`;
            if (handler instanceof Map) {
                const route = this.#route(path);
                for (const [method, data] of handler) {
                    if (route.has(method))
                        throw new Error('Route already exists for this method');
                    route.set(method, data);
                }
            } else {
                if (this.#routes.has(path))
                    throw new Error('Route already exists for this path');
                this.#routes.set(path, handler);
            }
        }
    }

    mount(path: string, { propertyKey, init, type }: {
        propertyKey: string | symbol;
        type: 'Generator' | 'Function' | 'Static',
        init?: {
            headers?: HeadersInit;
            status?: number;
            statusText?: string;
        };
    }) {
        path = path.replace(/^\/?/, '/');
        if (this.#routes.has(path))
            throw new Error('Route already exists for this path');
        if (type === 'Static') {
            const type = getType(this.target.prototype, propertyKey);
            if (typeof type === 'function' && isController(type)) {
                this.mountController(path, getController(type));
                this.injectList.set(propertyKey, type);
                return;
            }
        }
        this.#routes.set(path, {
            controller: this,
            propertyKey,
            type,
            init: {
                ...init,
                headers: Object.fromEntries(new Headers(init?.headers)),
            },
        });
    }
    route(path: string, { method, propertyKey, init, type }: {
        propertyKey: string | symbol;
        method: HTTPMethod;
        type: 'Generator' | 'Function' | 'Static',
        init?: {
            headers?: HeadersInit;
            status?: number;
            statusText?: string;
        };
    }) {
        path = path.replace(/^\/?/, '/');
        const route = this.#route(path);
        if (route.has(method))
            throw new Error('Route already exists for this method');
        route.set(method, {
            controller: this,
            type,
            propertyKey,
            init: {
                ...init,
                headers: Object.fromEntries(new Headers(init?.headers)),
            },
        });
    }
    hook({ hook: name, propertyKey, init, type }: {
        hook: RequestLifecycleHook;
        propertyKey: string | symbol;
        type: 'Generator' | 'Function',
        init?: {
            headers?: HeadersInit;
            status?: number;
            statusText?: string;
        };
    }) {
        if (!RequestLifecycleHook.includes(name))
            throw new Error(`Invalid hook: ${name}`);
        let hooks = this.hooks.get(name);
        if (!hooks)
            this.hooks.set(name, hooks = []);
        hooks.push({
            controller: this,
            propertyKey,
            type,
            init: {
                ...init,
                headers: Object.fromEntries(new Headers(init?.headers)),
            },
        });
    }
}

const controllerList = new WeakMap<Function, Controller>();
const getController = instanceBucket(controllerList, Controller);
function isController(controller: Function) {
    return controllerList.has(controller);
}

export type { Handler, Static, Controller };
export { getController };
export type { RequestLifecycleHook, HTTPMethod };
