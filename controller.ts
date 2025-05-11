import 'reflect-metadata/lite';
import { instanceBucket } from './bucket';
import { getParamTypes, type ParamTypes } from './service';
import { getMethodType, getStack, type MethodType } from './util';
import type { HeadersInit } from 'bun';

const RequestLifecycleHook = ['beforeHandle', 'mapResponse', 'afterHandle'] as const;
type RequestLifecycleHook = typeof RequestLifecycleHook[number];

type HTTPMethod = import('bun').RouterTypes.HTTPMethod;

interface Handler {
    stack?: string;

    controller: Controller;
    propertyKey: string | symbol;
    type: MethodType,
    paramtypes: ParamTypes;
    init: {
        headers?: Record<string, string>;
        status?: number;
        statusText?: string;
    };
}
interface Static {
    stack?: string;

    controller: Controller;
    propertyKey: string | symbol;
    init: {
        headers?: Record<string, string>;
        status?: number;
        statusText?: string;
    };
}

class Controller {
    declare stack?: string;

    #prefix?: '/' | `/${string}/`;
    setPrefix(value = '') {
        if (typeof this.#prefix === 'string')
            throw new Error('Prefix has already been set');
        if (typeof value !== 'string')
            throw new TypeError();
        this.#prefix = value.replaceAll(/^(?!\/)|(?<!\/)$/g, '/').replaceAll('$', '$$$$') as '/' | `/${string}/`;

        if (process.env.NODE_ENV !== 'production')
            this.stack = getStack();
    }

    constructor(public readonly target: Function) {
        if (typeof target !== 'function')
            throw new TypeError();
    }

    #getParamTypes(propertyKey: string | symbol) {
        return getParamTypes(this.target.prototype, propertyKey);
    }

    #use: Set<Controller> = new Set();

    readonly hooks: Map<RequestLifecycleHook, Handler[]> = new Map();
    readonly #routes: Map<string, Map<HTTPMethod, Handler> | Handler | Static> = new Map();

    *handlers() {
        if (!this.#prefix)
            throw new Error('Cannot use a disabled controller');
        for (const [path, handlers] of this.#routes) {
            yield [path.replace(/^\/?/, this.#prefix) as `/${string}`, handlers] as const;
        }
    }

    #route(path: string) {
        let route: Map<HTTPMethod, Handler> | Handler | Static;
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
        const mount = router;
        if (!mount.#prefix)
            throw new Error('Cannot mount a disabled controller');
        const prefix = path.replace(/^(?!\/)|(?<!\/)$/g, '/').replaceAll('$', '$$$$');
        for (let [path, handler] of mount.handlers()) {
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

    static(path: string, options: {
        propertyKey: string | symbol;
        init?: {
            headers?: HeadersInit;
            status?: number;
            statusText?: string;
        };
    }) {
        path = path.replace(/^\/?/, '/');
        if (this.#routes.has(path))
            throw new Error('Route already exists for this path');
        const { propertyKey, init } = options;
        this.#routes.set(path, {
            controller: this,
            propertyKey,
            init: {
                ...init,
                headers: Object.fromEntries(new Headers(init?.headers)),
            },
        });

        if (process.env.NODE_ENV !== 'production')
            (this.#routes.get(path) as Static)!.stack = getStack();
    }
    mount(path: string, router: {
        propertyKey: string | symbol;
        value: unknown,
        init?: {
            headers?: HeadersInit;
            status?: number;
            statusText?: string;
        };
    }) {
        path = path.replace(/^\/?/, '/');
        if (this.#routes.has(path))
            throw new Error('Route already exists for this path');
        const { propertyKey, init, value } = router;
        this.#routes.set(path, {
            controller: this,
            propertyKey,
            type: getMethodType(value),
            paramtypes: this.#getParamTypes(propertyKey),
            init: {
                ...init,
                headers: Object.fromEntries(new Headers(init?.headers)),
            },
        });

        if (process.env.NODE_ENV !== 'production')
            (this.#routes.get(path) as Handler)!.stack = getStack();
    }
    route(path: string, options: {
        propertyKey: string | symbol;
        method: HTTPMethod;
        value: unknown,
        init?: {
            headers?: HeadersInit;
            status?: number;
            statusText?: string;
        };
    }) {
        path = path.replace(/^\/?/, '/');
        const { method, propertyKey, init, value } = options;
        const route = this.#route(path);
        if (route.has(method))
            throw new Error('Route already exists for this method');
        route.set(method, {
            controller: this,
            type: getMethodType(value),
            propertyKey,
            init: {
                ...init,
                headers: Object.fromEntries(new Headers(init?.headers)),
            },
            paramtypes: this.#getParamTypes(propertyKey),
        });

        if (process.env.NODE_ENV !== 'production')
            route.get(method)!.stack = getStack();
    }
    hook(options: {
        hook: RequestLifecycleHook;
        propertyKey: string | symbol;
        value: unknown,
        init?: {
            headers?: HeadersInit;
            status?: number;
            statusText?: string;
        };
    }) {
        const { hook: name, propertyKey, init, value } = options;
        if (!RequestLifecycleHook.includes(name))
            throw new Error(`Invalid hook: ${name}`);
        let hooks = this.hooks.get(name);
        if (!hooks)
            this.hooks.set(name, hooks = []);
        hooks.push({
            controller: this,
            propertyKey,
            type: getMethodType(value),
            paramtypes: this.#getParamTypes(propertyKey),
            init: {
                ...init,
                headers: Object.fromEntries(new Headers(init?.headers)),
            },
        });

        if (process.env.NODE_ENV !== 'production')
            hooks[hooks.length - 1]!.stack = getStack();
    }
}

const getController = instanceBucket(new WeakMap<Function, Controller>(), Controller);

export type { Handler, Static, Controller };
export { getController };
export type { RequestLifecycleHook, HTTPMethod };
