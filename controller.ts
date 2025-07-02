import type { HeadersInit, HTMLBundle } from 'bun';
import { instanceBucket } from './bucket';
import { construct, getParamTypes, getType, inject, ParamType } from './service';
import { newResponse } from './util';

const RequestLifecycleHook = ['beforeHandle', 'afterHandle', 'mapResponse'] as const;
type RequestLifecycleHook = typeof RequestLifecycleHook[number];

type HTTPMethod = import('bun').RouterTypes.HTTPMethod;

interface Init {
    headers?: Record<string, string | string[]>;
    status?: number;
    statusText?: string;
};

function checkBodyPresence(paramtypes: Iterable<ParamType>, checked = new Set<Function>()) {
    for (const type of paramtypes) {
        if (typeof type === 'function') {
            if (checked.has(type))
                continue;
            checked.add(type);
            if (checkBodyPresence(getParamTypes(type), checked))
                return true;
            continue;
        }
        if (type.identifier === 'body')
            return true;
    }
    return false;
}

type Meta = ReturnType<typeof Meta>;
function Meta({ controller: { target }, propertyKey, init, type }: Handler) {
    return {
        instance: construct(target),
        propertyKey,
        paramtypes: getParamTypes(target.prototype, propertyKey),
        init: {
            ...init,
            headers: Object.fromEntries(new Headers(init?.headers)),
        },
        isGenerator: type === 'Generator',
    };
}

function assignHeaders(headers: Record<string, string | string[]>, init?: Record<string, string | string[]>) {
    for (const name in init) {
        const value = init[name]!;
        if (Array.isArray(value))
            headers[name] = Array.isArray(headers[name])
                ? [...headers[name], ...value]
                : [headers[name]!, ...value];
        else
            headers[name] = value;
    }
    return headers;
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
    propertyKey?: string | symbol;
    init?: {
        headers?: HeadersInit;
        status?: number;
        statusText?: string;
    };
    env?: Route[];
}
interface Handler extends Route {
    type: 'Generator' | 'Function';
    propertyKey: string | symbol;
}
interface Static extends Route {
    type: 'Static';
    propertyKey: string | symbol;
}

class Controller {

    static #list = new WeakMap<Function, Controller>();
    static from = instanceBucket(this.#list, Controller);
    static isController(controller: Function) {
        if (typeof controller === 'function' && this.#list.has(controller)) {
            if (this.#list.get(controller)!.#enable)
                return true;
        }
        return false;
    }

    constructor(public readonly target: Function) {
        if (typeof target !== 'function')
            throw new TypeError();
    }

    #enable = false;
    #prefix?: string;
    #init: {
        headers: Record<string, string | string[]>;
        status?: number;
        statusText?: string;
    } = { headers: {} };
    init({ prefix, init }: {
        prefix?: string;
        init?: Init;
    }) {
        if (this.#enable)
            throw new Error('Controller has been initialized');
        this.#enable = true;
        this.#prefix = prefix;
        this.#init = {
            ...this.#init,
            ...init,
            headers: assignHeaders(this.#init.headers, init?.headers),
        };
    }

    #use: Controller[] = [];

    #handlerIndex = 0;
    readonly #hookList: Map<RequestLifecycleHook, Handler[]> = new Map();

    static *#hooks({ controller, index, env }: Route, name: RequestLifecycleHook): Generator<Handler> {
        switch (name) {
            case 'beforeHandle': {
                if (env) for (const handler of env.toReversed()) {
                    yield* this.#hooks(handler, name);
                }
                for (const hookController of controller.#use) {
                    if (hookController.#hookList.has(name))
                        yield* hookController.#hookList.get(name)!;
                }
                if (controller.#hookList.has(name)) for (const handler of controller.#hookList.get(name)!) {
                    if (handler.index < index)
                        yield handler;
                }
            } break;
            case 'afterHandle':
            case 'mapResponse': {
                if (controller.#hookList.has(name)) for (const handler of controller.#hookList.get(name)!) {
                    if (handler.index > index)
                        yield handler;
                }
                for (const hookController of controller.#use) {
                    if (hookController.#hookList.has(name))
                        yield* hookController.#hookList.get(name)!;
                }
                if (env) for (const handler of env) {
                    yield* this.#hooks(handler, name);
                }
            } break;
        }
    }
    static getMeta(handler: Handler) {
        const handle = Meta(handler);
        const beforeHandle = this.#hooks(handler, 'beforeHandle').map(Meta).toArray();
        const afterHandle = this.#hooks(handler, 'afterHandle').map(Meta).toArray();
        const mapResponse = this.#hooks(handler, 'mapResponse').map(Meta).toArray();
        const bodyPresence = checkBodyPresence(new Set([
            handle,
            ...beforeHandle,
            ...afterHandle,
            ...mapResponse,
        ].flatMap(({ paramtypes }) => paramtypes)));
        return {
            bodyPresence,
            beforeHandle,
            handle,
            afterHandle,
            mapResponse,
        };
    }

    readonly #routes: Map<string, Map<HTTPMethod, Handler | Static> | Handler | Static> = new Map();

    *#handlers() {
        if (!this.#enable)
            throw new Error('Cannot use a disabled controller');
        const prefix = String(this.#prefix ?? '/').replaceAll(/^(?!\/)|(?<!\/)$/g, '/').replaceAll('$', '$$$$') as '/' | `/${string}/`;
        for (const [path, handlers] of this.#routes) {
            yield [path.replace(/^\/?/, prefix) as `/${string}`, handlers] as const;
        }
    }

    map<T>(cb: (handler: Handler | Static) => T): Record<`/${string}`, T | Record<HTTPMethod, T>> {
        return Object.fromEntries(this.#handlers().map(([path, handlers]) => {
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
        if (!router.#enable)
            throw new Error('Cannot use a disabled controller');
        this.#init = {
            ...this.#init,
            ...router.#init,
            headers: assignHeaders(this.#init.headers, router.#init?.headers),
        };
        for (const controller of this.#use)
            controller.#init = {
                ...controller.#init,
                ...router.#init,
                headers: assignHeaders(controller.#init.headers, router.#init?.headers),
            };
        this.#use.push(router);
        this.#handlerIndex = NaN;
        this.mount('/', { propertyKey: undefined, router });
    }

    mount(path: string, { propertyKey, router, init }: {
        propertyKey?: string | symbol;
        router: Controller;
        init?: Init;
    }) {
        path = path.replace(/^\/?/, '/');
        if (!router.#enable)
            throw new Error('Cannot mount a disabled controller');
        const prefix = path.replace(/^(?!\/)|(?<!\/)$/g, '/').replaceAll('$', '$$$$');
        for (let [path, handler] of router.#handlers()) {
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
                if (Controller.isController(type)) {
                    this.mount(path, { propertyKey, router: Controller.from(type), init });
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
        let hooks = this.#hookList.get(name);
        if (!hooks)
            this.#hookList.set(name, hooks = []);
        hooks.push({
            index: this.#handlerIndex++,
            controller: this,
            propertyKey,
            type,
            init,
        });
    }
}

export type { Init, Handler, Static, Meta };
export { Controller, StaticResource };
export type { HTTPMethod, RequestLifecycleHook };
