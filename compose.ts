import type { BunRequest, Server, RouterTypes, HTMLBundle } from 'bun';
import { scheduler } from 'node:timers/promises';
import { type Handler, getController } from './controller';
import { construct } from './service';
import { parseBody, newResponse, parseQuery } from './util';
import { Parse } from '@sinclair/typebox/value';
import { TypeGuard } from '@sinclair/typebox';

interface Context extends BunRequest {
    _server: Server;
    _fulfilled: boolean;
    _response?: Response;
    _url?: URL;
    _query?: Record<string, unknown>;
    _body?: unknown;
    _set: {
        readonly headers: Record<string, string>;
        status?: number;
        statusText?: string;
    };
    _store?: Record<string, any>;
}

type HandlerMeta = ReturnType<typeof getMeta>;
function getMeta({ controller: { target }, propertyKey, paramtypes, init, type }: Handler) {
    return {
        instance: construct(target),
        propertyKey,
        paramtypes: paramtypes.map((type) => {
            if (typeof type === 'function')
                return { value: construct(type) };
            return type;
        }),
        ...init,
        isGenerator: type === 'GeneratorFunction' || type === 'AsyncGeneratorFunction',
    };
}

async function onHandle(ctx: Context, { instance, propertyKey, paramtypes, isGenerator, headers, status, statusText }: HandlerMeta) {
    const params: any[] = [];
    for (const type of paramtypes) {
        if ('value' in type) {
            params.push(type.value);
        } else {
            let value: any;
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
                    if (typeof ctx._body === 'undefined') {
                        value = ctx._body = await parseBody(ctx);
                    } else {
                        value = ctx._body;
                    }
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
            params.push(value);
        }
    }
    if (isGenerator) {
        const res = instance[propertyKey](...params);
        const { value, done } = await (res as Generator | AsyncGenerator).next();
        for (const name in headers) {
            ctx._set.headers[name] = headers[name]!;
        }
        if (typeof status === 'number')
            ctx._set.status = status;
        if (typeof statusText === 'string')
            ctx._set.statusText = statusText;
        if (done) {
            ctx._response = newResponse(value, ctx._set);
        } else {
            // ctx._response = new Response(async function* () { yield value, yield* (res as Generator | AsyncGenerator); } as any, ctx._set);

            ctx._set.headers['transfer-encoding'] ||= 'chunked';
            ctx._set.headers['content-type'] ||= 'text/event-stream;charset=utf-8';

            let end = false;
            ctx._response = new Response(new ReadableStream<string | ArrayBufferView | ArrayBuffer>({
                async start(controller) {
                    ctx.signal.addEventListener('abort', () => {
                        end = true;
                        controller.close();
                    });
                    if (value !== undefined && value !== null)
                        controller.enqueue(value as any);
                    {
                        const { value } = await (res as Generator | AsyncGenerator).next(controller);
                        if (!end) {
                            if (value !== undefined && value !== null) {
                                controller.enqueue(value as any);
                                await scheduler.yield();
                            }
                            for await (const chunk of res) {
                                if (end) break;
                                if (chunk === undefined || chunk === null) continue;
                                controller.enqueue(chunk);
                                await scheduler.yield();
                            }
                        }
                    }
                    controller.close();
                },
            }), ctx._set);
        }
        return ctx._fulfilled = true;
    }
    const res = await instance[propertyKey](...params);
    if (typeof res !== 'undefined') {
        for (const name in headers) {
            ctx._set.headers[name] = headers[name]!;
        }
        if (typeof status === 'number')
            ctx._set.status = status;
        if (typeof statusText === 'string')
            ctx._set.statusText = statusText;
        ctx._response = newResponse(res, ctx._set);
        return ctx._fulfilled = true;
    }
}

function compileHandler(handler: Handler) {
    const beforeHandles = handler.controller.hooks.get('beforeHandle')?.map(getMeta);
    const afterHandle = handler.controller.hooks.get('afterHandle')?.map(getMeta);
    const handlerMeta = getMeta(handler);
    return async (ctx: Context, server: Server) => {
        ctx._server = server;
        ctx._fulfilled = false;
        ctx._set = {
            headers: {},
            status: undefined,
            statusText: undefined
        };
        try {
            if (beforeHandles) for (const meta of beforeHandles) {
                if (await onHandle(ctx, meta))
                    return ctx._response!;
            }
            if (await onHandle(ctx, handlerMeta))
                return ctx._response!;
            ctx._set.status = 404;
            ctx._response = newResponse(null, ctx._set);
            ctx._fulfilled = true;
            return ctx._response;
        } finally {
            if (ctx._fulfilled && afterHandle) {
                ctx._set = { headers: {} }, ctx._fulfilled = false;
                for (const meta of afterHandle) {
                    if (await onHandle(ctx, meta))
                        ctx._set = { headers: {} };
                }
                if (ctx._fulfilled)
                    return ctx._response!;
            }
        }
    };
}

function routes(target: Function): Record<`/${string}`, (HTMLBundle & Response) | Response | RouterTypes.RouteHandler<string> | RouterTypes.RouteHandlerObject<string>> & {
    meta: Record<`/${string}`, Partial<Record<RouterTypes.HTTPMethod | '', string | null>>>;
} {
    const controller = getController(target);
    const meta: Record<`/${string}`, Partial<Record<RouterTypes.HTTPMethod | '', string | null>>> = {};
    const routes = Object.fromEntries(controller.handlers().map(([path, handlers]) => {
        if (handlers instanceof Map) {
            for (const [method, handler] of handlers)
                (meta[path] ??= {})[method] ??= handler.stack ?? null;
            return [path, Object.fromEntries(handlers.entries().map(([method, handler]) => [method, compileHandler(handler)]))];
        } else {
            (meta[path] ??= {})[''] ??= handlers.stack ?? null;
            if ('paramtypes' in handlers)
                return [path, compileHandler(handlers)];
            const { propertyKey, controller: { target }, init } = handlers;
            const value = construct(target)[propertyKey];
            if (Object.prototype.toString.call(value) === '[object HTMLBundle]')
                return [path, value];
            return [path, newResponse(construct(target)[propertyKey], init)];
        }
    }));
    Reflect.defineProperty(routes, 'meta', {
        value: meta,
        enumerable: false,
    });
    return routes as any;
}

export { routes };
