import type { BunRequest, Server, RouterTypes, HTMLBundle } from 'bun';
import { scheduler } from 'node:timers/promises';
import { type Handler, getController } from './controller';
import { construct } from './service';
import { parseBody, newResponse, parseQuery, Stream, type StreamLike } from './util';
import { Parse } from '@sinclair/typebox/value';
import { TypeGuard } from '@sinclair/typebox';

interface Context extends BunRequest {
    _server: Server;
    _fulfilled: boolean;
    _set: {
        readonly headers: Record<string, string>;
        status?: number;
        statusText?: string;
    };
    _rawResponse?: unknown;
    _response?: Response;
    _url?: URL;
    _query?: Record<string, unknown>;
    _body?: unknown;
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
        init,
        isGenerator: type === 'GeneratorFunction' || type === 'AsyncGeneratorFunction',
    };
}

async function mapParams(ctx: Context, paramtypes: HandlerMeta['paramtypes']) {
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
                case 'rawResponse': {
                    value = ctx._rawResponse;
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
    return params;
}

async function onHandle(ctx: Context, handlerMeta: HandlerMeta[]) {
    let fulfilled = false;
    for (const { instance, propertyKey, paramtypes, isGenerator, init } of handlerMeta) {
        const res = await instance[propertyKey](...await mapParams(ctx, paramtypes));
        if (isGenerator) {
            const { value, done } = await (res as StreamLike).next();
            ctx._rawResponse = done ? value : new Stream(value, res as StreamLike);
        } else if (typeof res === 'undefined') {
            continue;
        } else {
            ctx._rawResponse = res;
        }
        ctx._set = {
            ...ctx._set,
            ...init,
            headers: { ...ctx._set.headers, ...init.headers },
        };
        fulfilled = true;
    }
    if (!fulfilled)
        return;
    ctx._response = newResponse(ctx._rawResponse, ctx._set);
    ctx._rawResponse = undefined;
    ctx._fulfilled = true;
}

function compileHandler(handler: Handler) {
    const beforeHandle = handler.controller.hooks.get('beforeHandle')?.map(getMeta);
    const afterHandle = handler.controller.hooks.get('afterHandle')?.map(getMeta);
    const mapResponse = handler.controller.hooks.get('mapResponse')?.map(getMeta);
    const handlerMeta = mapResponse ? [getMeta(handler), ...mapResponse] : [getMeta(handler)];
    return async (ctx: Context, server: Server) => {
        ctx._server = server;
        ctx._fulfilled = false;
        ctx._set = {
            headers: {},
            status: undefined,
            statusText: undefined
        };
        try {
            if (beforeHandle) for (const meta of beforeHandle) {
                await onHandle(ctx, [meta]);
                if (ctx._fulfilled)
                    return ctx._response!;
            }
            await onHandle(ctx, handlerMeta);
            if (ctx._fulfilled)
                return ctx._response!;
            ctx._set.status = 404;
            ctx._response = newResponse(null, ctx._set);
            ctx._fulfilled = true;
            return ctx._response;
        } finally {
            if (ctx._fulfilled && afterHandle) {
                ctx._set = { headers: {} }, ctx._fulfilled = false;
                for (const meta of afterHandle) {
                    await onHandle(ctx, [meta]);
                    if (ctx._fulfilled)
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
            return [path, Object.fromEntries(handlers.entries().map(([method, handler]) => {
                if ('paramtypes' in handler)
                    return [method, compileHandler(handler)];
                const { propertyKey, controller: { target }, init } = handler;
                const value = construct(target)[propertyKey];
                if (Object.prototype.toString.call(value) === '[object HTMLBundle]')
                    return [method, value];
                return [method, newResponse(construct(target)[propertyKey], init)];
            }))];
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
