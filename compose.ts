import type { Server, RouterTypes, HTMLBundle, BunRequest } from 'bun';
import type { ResponseInit } from './decorators';
import { $ALL, Controller, HookType, type Handler, type Init } from './controller';
import { construct, getParamTypes, isSingleton, type ParamType } from './service';
import { newResponse, parseBody, parseQuery } from './util';
import { TypeGuard } from '@sinclair/typebox';
import { Parse } from '@sinclair/typebox/value';

interface Context extends BunRequest {
    _server: Server;
    _set: ResponseInit;
    _response?: Response;
    _url?: URL;
    _query?: Record<string, unknown>;
    _body?: unknown;
    _store?: Record<string, any>;
    _instances?: WeakMap<Function, any>;
}

function* mapParams(ctx: Context, paramtypes: ParamType[]): Generator<unknown> {
    for (const type of paramtypes) {
        if (typeof type === 'function') {
            if (isSingleton(type)) {
                yield construct(type);
                continue;
            }
            if (ctx._instances?.has(type)) {
                yield ctx._instances.get(type);
            } else {
                const value = new type(...mapParams(ctx, getParamTypes(type)));
                (ctx._instances ??= new WeakMap()).set(type, value);
                yield value;
            }
            continue;
        }
        let value;
        switch (type.identifier) {
            case 'url': {
                value = ctx._url ??= new URL(ctx.url);
            } break;
            case 'request': {
                value = ctx;
            } break;
            case 'server': {
                value = ctx._server;
            } break;
            case 'response': {
                value = ctx._response;
            } break;
            case 'responseInit': {
                value = ctx._set;
            } break;
            case 'store': {
                value = ctx._store ??= {};
            } break;
            case 'params': {
                value = ctx.params;
            } break;
            case 'query': {
                value = ctx._query ??= parseQuery((ctx._url ??= new URL(ctx.url)).searchParams);
            } break;
            case 'cookie': {
                value = ctx.cookies;
            } break;
            case 'body': {
                value = ctx._body as any;
            } break;
            default:
                throw new TypeError();
        }
        if (typeof type.key === 'string')
            value = Object.hasOwn(value, type.key) ? value[type.key] : undefined;
        if (TypeGuard.IsSchema(type.schema)) {
            value = type.operations ?
                Parse(type.operations, type.schema, value) :
                Parse(type.schema, value);
        }
        yield value;
    }
}

type StreamLike = IterableIterator<string | ArrayBuffer | ArrayBufferView<ArrayBufferLike>> | AsyncIterableIterator<string | ArrayBuffer | ArrayBufferView<ArrayBufferLike>>;

async function onHook(ctx: Context, { instance, propertyKey, paramtypes }: {
    instance: any;
    propertyKey: string | symbol;
    paramtypes: ParamType[];
}) {
    const res = await instance[propertyKey](...mapParams(ctx, paramtypes));
    if (typeof res === 'undefined')
        return false;
    ctx._response = res;
    return true;
}

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

function buildHandler({ type, controller: { target }, propertyKey, init, use }: Handler) {
    const instance = construct(target);
    const paramtypes = type === 'Accessor' ? undefined : getParamTypes(target.prototype, propertyKey);
    const set = use.reduceRight<Init>((previous, { controller: { global }, init }) => {
        return {
            ...previous,
            ...global?.init,
            ...init,
            headers: {
                ...previous?.headers,
                ...global?.init?.headers,
                ...init?.headers,
            },
        };
    }, {});
    const hooks = (Object.fromEntries as {
        <K extends PropertyKey, T>(entries: Iterable<readonly [K, T]>): { [k in K]: T; };
    })(HookType.map((name) => {
        return [name, Controller.hooks(use, name).map(({ controller: { target }, propertyKey }) => {
            return {
                instance: construct(target),
                propertyKey,
                paramtypes: getParamTypes(target.prototype, propertyKey),
            };
        }).toArray()] as const;
    }));
    const bodyPresence = checkBodyPresence(new Set([
        ...paramtypes ?? [],
        ...Object.values(hooks).flat().flatMap(({ paramtypes }) => paramtypes),
    ]));
    return async (ctx: Context, server: Server) => {
        ctx._server = server;
        ctx._set = {
            status: 200,
            ...set,
            headers: { ...set.headers },
        };
        let response: Response;
        try {
            RES: {
                for (const meta of hooks.request) {
                    if (await onHook(ctx, meta))
                        break RES;
                }
                if (bodyPresence) PARSE: {
                    for (const { instance, propertyKey, paramtypes } of hooks.parse) {
                        const value = await instance[propertyKey](...mapParams(ctx, paramtypes!));
                        if (typeof (ctx._body = value) !== 'undefined')
                            break PARSE;
                    }
                    ctx._body = await parseBody(ctx);
                }
                for (const meta of hooks.beforeHandle) {
                    if (await onHook(ctx, meta))
                        break RES;
                }
                if (init) {
                    ctx._set = {
                        ...ctx._set,
                        ...init,
                        headers: {
                            ...ctx._set?.headers,
                            ...init?.headers,
                        },
                    };
                }
                if (!paramtypes) {
                    ctx._response = instance[propertyKey];
                } else {
                    const res = await instance[propertyKey](...mapParams(ctx, paramtypes));
                    if (type === 'Generator') {
                        const { value, done } = await (res as StreamLike).next();
                        ctx._response = done ? value : new ReadableStream({
                            async start(controller) {
                                let end = false;
                                ctx.signal.addEventListener('abort', () => {
                                    end = true;
                                    try { controller.close(); } catch { }
                                });
                                typeof value !== 'undefined' && controller.enqueue(value);
                                for await (const chunk of res as StreamLike) {
                                    if (end)
                                        break;
                                    typeof chunk !== 'undefined' && controller.enqueue(chunk);
                                    await Bun.sleep(0);
                                }
                                try { controller.close(); } catch { }
                            },
                        });
                    } else if (typeof res === 'undefined') {
                        throw new Error();
                    } else {
                        ctx._response = res;
                    }
                }
                for (const meta of hooks.afterHandle)
                    await onHook(ctx, meta);
            }
            for (const meta of hooks.mapResponse)
                if (await onHook(ctx, meta))
                    break;
            return response = newResponse(ctx._response, ctx._set);
        } finally {
            if (hooks.afterResponse.length) {
                const { status, statusText, headers } = response!;
                ctx._response = undefined;
                ctx._set = { status, statusText, headers: Object.fromEntries(headers) };
                process.nextTick(async () => {
                    for (const { instance, propertyKey, paramtypes } of hooks.afterResponse)
                        await instance[propertyKey](...mapParams(ctx, paramtypes!));
                });
            }
        }
    };
}

function routes(target: Function) {
    const controller = Controller.from(target);
    return Object.fromEntries(controller.routes().map(([path, route]) => {
        if (route instanceof Map) {
            const handlers = new Map(route.entries().map(([method, handler]) => {
                return [method, buildHandler(handler)] as const;
            }));
            const defaultHandler = handlers.get($ALL);
            return [path, (ctx: Context, server: Server) => {
                const handler = handlers.get(ctx.method as Uppercase<string>) ?? defaultHandler;
                if (handler)
                    return handler(ctx, server);
                return new Response(null, { status: 404 });
            }];
        } else {
            const { controller: { target }, propertyKey, init, use } = route;
            const value = construct(target)[propertyKey];
            if (typeof value === 'object' && 'index' in value)
                return [path, value as import('bun').HTMLBundle] as const;
            return [path, newResponse(value, use.reduceRight((previous, { controller: { global }, init }) => {
                return {
                    ...previous,
                    ...global?.init,
                    ...init,
                    headers: {
                        ...previous?.headers,
                        ...global?.init?.headers,
                        ...init?.headers,
                    },
                };
            }, init))] as const;
        }
    })) as Record<`/${string}`, (HTMLBundle & Response) | Response | RouterTypes.RouteHandler<string> | RouterTypes.RouteHandlerObject<string>>;
}

export { routes };
