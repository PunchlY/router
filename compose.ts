import type { Server, RouterTypes, HTMLBundle, BunRequest } from 'bun';
import { type Meta, StaticResource, Controller } from './controller';
import { construct, getParamTypes, getScope, type ParamType } from './service';
import { newResponse, parseBody, parseQuery } from './util';
import { TypeGuard } from '@sinclair/typebox';
import { Parse } from '@sinclair/typebox/value';

interface Context extends BunRequest {
    _server: Server;
    _set: {
        readonly headers: Record<string, string | string[]>;
        status?: number;
        statusText?: string;
    };
    _rawResponse?: unknown;
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
            switch (getScope(type)) {
                case 'SINGLETON': {
                    yield construct(type);
                } return;
                case 'REQUEST': if (ctx._instances?.has(type)) {
                    yield ctx._instances.get(type);
                } else {
                    const value = new type(...mapParams(ctx, getParamTypes(type)));
                    (ctx._instances ??= new WeakMap()).set(type, value);
                    yield value;
                } return;
                case 'INSTANCE': {
                    yield new type(...mapParams(ctx, getParamTypes(type)));
                } return;
                default:
                    throw new TypeError();
            }
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
async function onHandle(ctx: Context, { instance, propertyKey, paramtypes, isGenerator, init }: Meta) {
    const res = await instance[propertyKey](...mapParams(ctx, paramtypes));
    if (isGenerator) {
        const { value, done } = await (res as StreamLike).next();
        ctx._rawResponse = done ? value : new ReadableStream({
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
        return false;
    } else {
        ctx._rawResponse = res;
    }
    ctx._set = {
        ...ctx._set,
        ...init,
        headers: { ...ctx._set.headers, ...init.headers },
    };
    return true;
}

function routes(target: Function) {
    return Controller.from(target).map((handler) => {
        if (handler.type === 'Static')
            return StaticResource(handler);
        const {
            bodyPresence,
            beforeHandle,
            handle,
            afterHandle,
            mapResponse,
        } = Controller.getMeta(handler);
        return async (ctx: Context, server: Server) => {
            let fulfilled = false;
            ctx._server = server;
            ctx._set = {
                headers: {},
                status: undefined,
                statusText: undefined
            };
            if (bodyPresence)
                ctx._body = await parseBody(ctx);
            try {
                for (const meta of beforeHandle) {
                    if (await onHandle(ctx, meta)) {
                        ctx._response = newResponse(ctx._rawResponse, ctx._set);
                        ctx._rawResponse = undefined;
                        fulfilled = true;
                        return ctx._response;
                    }
                }
                if (await onHandle(ctx, handle)) {
                    for (const meta of mapResponse)
                        await onHandle(ctx, meta);
                    ctx._response = newResponse(ctx._rawResponse, ctx._set);
                    ctx._rawResponse = undefined;
                    fulfilled = true;
                    return ctx._response;
                }
                ctx._set.status = 404;
                ctx._response = newResponse(null, ctx._set);
                ctx._rawResponse = undefined;
                fulfilled = true;
                return ctx._response;
            } finally {
                if (fulfilled) {
                    ctx._set = { headers: {} }, fulfilled = false;
                    for (const meta of afterHandle) {
                        if (!await onHandle(ctx, meta))
                            continue;
                        ctx._response = newResponse(ctx._rawResponse, ctx._set);
                        ctx._rawResponse = undefined;
                        ctx._set = { headers: {} };
                        fulfilled = true;
                    }
                    if (fulfilled)
                        return ctx._response!;
                }
            }
        };
    }) as Record<`/${string}`, (HTMLBundle & Response) | Response | RouterTypes.RouteHandler<string> | RouterTypes.RouteHandlerObject<string>>;
}

export { routes };
