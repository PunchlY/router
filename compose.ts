import type { Server, RouterTypes, HTMLBundle } from 'bun';
import { type Handler, getController } from './controller';
import { construct, mapParams, type Context } from './service';
import { newResponse, Stream, type StreamLike } from './util';

type HandlerMeta = ReturnType<typeof getMeta>;
function getMeta({ controller: { target }, propertyKey, paramtypes, init, type }: Handler) {
    return {
        instance: construct(target),
        propertyKey,
        paramtypes,
        init,
        isGenerator: type === 'GeneratorFunction' || type === 'AsyncGeneratorFunction',
    };
}

async function onHandle(ctx: Context, handlerMeta: HandlerMeta, mapResponse?: HandlerMeta[]) {
    let fulfilled = false;
    for (const { instance, propertyKey, paramtypes, isGenerator, init } of mapResponse ? [handlerMeta, ...mapResponse] : [handlerMeta]) {
        const res = await instance[propertyKey](...await mapParams(ctx, paramtypes));
        if (isGenerator) {
            const { value, done } = await (res as StreamLike).next();
            ctx._rawResponse = done ? value : new Stream(value, res as StreamLike);
        } else if (typeof res === 'undefined') {
            if (!fulfilled)
                break;
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
            if (beforeHandle) for (const meta of beforeHandle) {
                await onHandle(ctx, meta);
                if (ctx._fulfilled)
                    return ctx._response!;
            }
            await onHandle(ctx, handlerMeta, mapResponse);
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
                    await onHandle(ctx, meta);
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
