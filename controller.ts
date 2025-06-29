import type { HeadersInit, HTMLBundle } from 'bun';
import { instanceBucket } from './bucket';
import { construct, getParamTypes, getType, inject } from './service';
import { newResponse } from './util';

const RequestLifecycleHook = ['beforeHandle', 'afterHandle', 'mapResponse'] as const;
type RequestLifecycleHook = typeof RequestLifecycleHook[number];

type HTTPMethod = import('bun').RouterTypes.HTTPMethod;

interface Init {
    headers?: HeadersInit;
    status?: number;
    statusText?: string;
};
function Init({ controller: { opt }, init }: Route) {
    if (!opt)
        throw new Error('Cannot use a disabled controller');
    return {
        ...init,
        ...opt.init,
        headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            ...Object.fromEntries(new Headers(opt.init?.headers)),
        },
    };
}

type Meta = ReturnType<typeof Meta>;
function Meta(handler: Handler) {
    let init = Init(handler);
    if (handler.env) for (const _init of handler.env.map(Init)) {
        init = {
            ...init,
            ..._init,
            headers: { ...init.headers, ..._init.headers },
        };
    }
    const { controller: { target }, propertyKey, type } = handler;
    return {
        instance: construct(target),
        propertyKey,
        paramtypes: getParamTypes(target.prototype, propertyKey),
        init,
        isGenerator: type === 'Generator',
    };
}

type StaticResource = HTMLBundle | Response;
function StaticResource({ propertyKey, controller: { target }, init }: Static) {
    const value = construct(target)[propertyKey];
    if (Object.prototype.toString.call(value) === '[object HTMLBundle]')
        return value as HTMLBundle;
    return newResponse(value, {
        ...init,
        headers: Object.fromEntries(new Headers(init?.headers)),
    });
}

interface Route {
    index: number;
    controller: Controller;
    propertyKey: string | symbol;
    init?: {
        headers?: HeadersInit;
        status?: number;
        statusText?: string;
    };
    env?: Route[];
}
interface Handler extends Route {
    type: 'Generator' | 'Function';
}
interface Static extends Route {
    type: 'Static';
}

class Controller {
    constructor(public readonly target: Function) {
        if (typeof target !== 'function')
            throw new TypeError();
    }

    opt?: {
        prefix?: string;
        init?: Init;
    };
    init(opt: {
        prefix?: string;
        init?: Init;
    }) {
        if (this.opt)
            throw new Error('Controller has been initialized');
        this.opt = opt;
    }

    #use: Controller[] = [];

    #handlerIndex = 0;
    readonly #hooks: Map<RequestLifecycleHook, Handler[]> = new Map();
    readonly #routes: Map<string, Map<HTTPMethod, Handler | Static> | Handler | Static> = new Map();

    *hooks(name: RequestLifecycleHook, { index, env }: Route): Generator<Handler> {
        switch (name) {
            case 'beforeHandle': {
                if (env) for (const handler of env.toReversed()) {
                    yield* handler.controller.hooks(name, handler);
                }
                for (const controller of this.#use) {
                    if (controller.#hooks.has(name))
                        yield* controller.#hooks.get(name)!;
                }
                if (this.#hooks.has(name)) for (const handler of this.#hooks.get(name)!) {
                    if (handler.index < index)
                        yield handler;
                }
            } break;
            case 'afterHandle':
            case 'mapResponse': {
                if (this.#hooks.has(name)) for (const handler of this.#hooks.get(name)!) {
                    if (handler.index > index)
                        yield handler;
                }
                for (const controller of this.#use) {
                    if (controller.#hooks.has(name))
                        yield* controller.#hooks.get(name)!;
                }
                if (env) for (const handler of env) {
                    yield* handler.controller.hooks(name, handler);
                }
            } break;
        }
    }

    *handlers() {
        if (!this.opt)
            throw new Error('Cannot use a disabled controller');
        const prefix = String(this.opt.prefix ?? '/').replaceAll(/^(?!\/)|(?<!\/)$/g, '/').replaceAll('$', '$$$$') as '/' | `/${string}/`;
        for (const [path, handlers] of this.#routes) {
            yield [path.replace(/^\/?/, prefix) as `/${string}`, handlers] as const;
        }
    }

    map<T>(cb: (handler: Handler | Static) => T): Record<`/${string}`, T | Record<HTTPMethod, T>> {
        return Object.fromEntries(this.handlers().map(([path, handlers]) => {
            if (handlers instanceof Map) {
                return [path, Object.fromEntries(handlers.entries().map(([method, handler]) => [method, cb(handler)]))];
            } else {
                return [path, cb(handlers)];
            }
        }));
    }

    #methodRoute(path: string) {
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
        if (!router.opt)
            throw new Error('Cannot use a disabled controller');
        this.#use.push(router);
        this.#handlerIndex = NaN;
        this.mount('/', { propertyKey: 'constructor', router });
    }

    mount(path: string, { propertyKey, router, init }: {
        propertyKey: string | symbol;
        router: Controller;
        init?: Init;
    }) {
        path = path.replace(/^\/?/, '/');
        if (!router.opt)
            throw new Error('Cannot mount a disabled controller');
        const prefix = path.replace(/^(?!\/)|(?<!\/)$/g, '/').replaceAll('$', '$$$$');
        for (let [path, handler] of router.handlers()) {
            path = path.replace(/^\/?/, prefix) as `/${string}`;
            if (handler instanceof Map) {
                const route = this.#methodRoute(path);
                for (let [method, data] of handler) {
                    if (route.has(method))
                        throw new Error('Route already exists for this method');
                    route.set(method, {
                        ...data,
                        env: [
                            ...(data.env ?? []),
                            {
                                index: this.#handlerIndex++,
                                controller: this,
                                propertyKey,
                                init,
                            },
                        ],
                    });
                }
            } else {
                if (this.#routes.has(path))
                    throw new Error('Route already exists for this path');
                this.#routes.set(path, {
                    ...handler,
                    env: [
                        ...(handler.env ?? []),
                        {
                            index: this.#handlerIndex++,
                            controller: this,
                            propertyKey,
                            init,
                        },
                    ],
                });
            }
        }
    }

    route(path: string, { method, propertyKey, init, type }: {
        propertyKey: string | symbol;
        method?: HTTPMethod;
        type: 'Generator' | 'Function' | 'Static',
        init?: Init;
    }) {
        path = path.replace(/^\/?/, '/');
        if (typeof method === 'undefined') {
            if (this.#routes.has(path))
                throw new Error('Route already exists for this path');
            if (type === 'Static') {
                const type = getType(this.target.prototype, propertyKey);
                if (isController(type)) {
                    this.mount(path, { propertyKey, router: getController(type), init });
                    inject(this.target.prototype, propertyKey, type);
                    return;
                }
            }
            this.#routes.set(path, {
                index: this.#handlerIndex++,
                controller: this,
                propertyKey,
                type,
                init,
            });
            return;
        }
        const route = this.#methodRoute(path);
        if (route.has(method))
            throw new Error('Route already exists for this method');
        route.set(method, {
            index: this.#handlerIndex++,
            controller: this,
            type,
            propertyKey,
            init,
        });
    }
    hook({ hook: name, propertyKey, init, type }: {
        hook: RequestLifecycleHook;
        propertyKey: string | symbol;
        type: 'Generator' | 'Function',
        init?: Init;
    }) {
        if (!RequestLifecycleHook.includes(name))
            throw new Error(`Invalid hook: ${name}`);
        let hooks = this.#hooks.get(name);
        if (!hooks)
            this.#hooks.set(name, hooks = []);
        hooks.push({
            index: this.#handlerIndex++,
            controller: this,
            propertyKey,
            type,
            init,
        });
    }
}

const controllerList = new WeakMap<Function, Controller>();
const getController = instanceBucket(controllerList, Controller);
function isController(controller: Function) {
    return typeof controller === 'function' && controllerList.has(controller);
}

export type { Route, Handler, Static, Controller };
export { getController, Init, Meta, StaticResource };
export type { HTTPMethod, RequestLifecycleHook };
