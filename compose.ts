import type { Server, RouterTypes, HTMLBundle, BunRequest } from 'bun';
import { type Handler, type Static, getController } from './controller';
import { construct, getParamTypes, type ParamType } from './service';
import { newResponse, parseBody, parseQuery, Stream, type StreamLike } from './util';
import { TypeGuard } from '@sinclair/typebox';
import { Parse } from '@sinclair/typebox/value';

interface Context extends BunRequest {
    _server: Server;
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
    _instances?: WeakMap<Function, any>;
}

async function mapParams(ctx: Context, paramtypes: ParamType[]) {
    const params: any[] = [];
    for (const type of paramtypes) {
        if (typeof type.identifier === 'function') {
            if (type.scope === 'SINGLETON') {
                params.push(construct(type.identifier));
                continue;
            }
            if (type.scope === 'REQUEST' && ctx._instances?.has(type.identifier)) {
                params.push(ctx._instances.get(type.identifier));
                continue;
            }
            const instance = Reflect.construct(type.identifier, await mapParams(ctx, getParamTypes(type.identifier)));
            if (type.scope === 'REQUEST')
                (ctx._instances ??= new WeakMap()).set(type.identifier, instance);
            params.push(instance);
            continue;
        }
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
    return params;
}

type HandlerMeta = ReturnType<typeof getMeta>;
function getMeta({ controller: { target }, propertyKey, init, type }: Handler) {
    return {
        instance: construct(target),
        propertyKey,
        paramtypes: getParamTypes(target, propertyKey),
        init,
        isGenerator: type === 'GeneratorFunction' || type === 'AsyncGeneratorFunction',
    };
}

async function onHandle(ctx: Context, { instance, propertyKey, paramtypes, isGenerator, init }: HandlerMeta) {
    const res = await instance[propertyKey](...await mapParams(ctx, paramtypes));
    if (isGenerator) {
        const { value, done } = await (res as StreamLike).next();
        ctx._rawResponse = done ? value : new Stream(value, res as StreamLike);
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

function compileHandler(handler: Handler) {
    const beforeHandle = handler.controller.hooks.get('beforeHandle')?.map(getMeta);
    const afterHandle = handler.controller.hooks.get('afterHandle')?.map(getMeta);
    const mapResponse = handler.controller.hooks.get('mapResponse')?.map(getMeta);
    const handlerMeta = getMeta(handler);
    return async (ctx: Context, server: Server) => {
        let fulfilled = false;
        ctx._server = server;
        ctx._set = {
            headers: {},
            status: undefined,
            statusText: undefined
        };
        try {
            if (beforeHandle) for (const meta of beforeHandle) {
                if (await onHandle(ctx, meta)) {
                    ctx._response = newResponse(ctx._rawResponse, ctx._set);
                    ctx._rawResponse = undefined;
                    fulfilled = true;
                    return ctx._response;
                }
            }
            if (await onHandle(ctx, handlerMeta)) {
                if (mapResponse) for (const handlerMeta of mapResponse)
                    await onHandle(ctx, handlerMeta);
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
            if (fulfilled && afterHandle) {
                ctx._set = { headers: {} }, fulfilled = false;
                for (const meta of afterHandle) {
                    await onHandle(ctx, meta);
                    ctx._response = newResponse(ctx._rawResponse, ctx._set);
                    ctx._rawResponse = undefined;
                    fulfilled = true;
                    if (fulfilled)
                        ctx._set = { headers: {} };
                }
                if (fulfilled)
                    return ctx._response!;
            }
        }
    };
}

function getStaticResource({ propertyKey, controller: { target }, init }: Static) {
    const value = construct(target)[propertyKey];
    if (Object.prototype.toString.call(value) === '[object HTMLBundle]')
        return value as HTMLBundle;
    return newResponse(construct(target)[propertyKey], init);
}

function routes(target: Function): Record<`/${string}`, (HTMLBundle & Response) | Response | RouterTypes.RouteHandler<string> | RouterTypes.RouteHandlerObject<string>> {
    const controller = getController(target);
    const routes = Object.fromEntries(controller.handlers().map(([path, handlers]) => {
        if (handlers instanceof Map) {
            return [path, Object.fromEntries(handlers.entries().map(([method, handler]) => {
                if ('type' in handler)
                    return [method, compileHandler(handler)];
                return [method, getStaticResource(handler)];
            }))];
        } else {
            if ('type' in handlers)
                return [path, compileHandler(handlers)];
            return [path, getStaticResource(handlers)];
        }
    }));
    return routes as any;
}

export { routes };
