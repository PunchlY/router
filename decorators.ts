import { Controller as $Controller, type HTTPMethod, type Init, type RequestLifecycleHook } from './controller';
import type { TSchema } from '@sinclair/typebox';
import { registerInjectable, register, setParamType, getType, inject } from './service';
import type { TParseOperation } from '@sinclair/typebox/value';
import { Decorators } from './util';

const AsyncGeneratorFunction = async function* () { }.constructor as AsyncGeneratorFunctionConstructor;
const GeneratorFunction = function* () { }.constructor as GeneratorFunctionConstructor;
function functionType(value: any) {
    if (typeof value !== 'function')
        throw new TypeError();
    if (value instanceof AsyncGeneratorFunction || value instanceof GeneratorFunction)
        return 'Generator';
    return 'Function';
}

function Controller(opt?: { prefix?: string, init?: Init; }) {
    return Decorators({
        class(target) {
            $Controller.from(target).init({ ...opt });
            registerInjectable(target, 'SINGLETON');
        },
    });
}

function Injectable(opt?: { scope?: 'SINGLETON' | 'REQUEST' | 'INSTANCE'; }) {
    return Decorators({
        class(target) {
            registerInjectable(target, opt?.scope ?? 'SINGLETON');
        },
    });
}

function Inject() {
    return Decorators({
        property(target, propertyKey) {
            const type = getType(target, propertyKey);
            if (typeof type !== 'function')
                throw new TypeError();
            inject(target, propertyKey, type);
        },
    });
}

function Use(controller: Function) {
    return Decorators({
        class(target) {
            $Controller.from(target).use($Controller.from(controller));
        },
    });
}

function Hook(hook: RequestLifecycleHook, init?: Init) {
    return Decorators({
        method({ constructor }, propertyKey, { value }) {
            $Controller.from(constructor).hook({ propertyKey, hook, init, type: functionType(value) });
        },
    });
}

function Route(path?: `/${string}`, init?: Init): Decorators<'method' | 'property'>;
function Route(init: Init): Decorators<'method' | 'property'>;
function Route(method: HTTPMethod, path?: string, init?: Init): Decorators<'method' | 'property'>;
function Route(method: HTTPMethod, init: Init): Decorators<'method' | 'property'>;
function Route(method?: HTTPMethod | `/${string}` | Init, path?: string | Init, init?: Init) {
    return Decorators(['method', 'property'], ({ constructor }, propertyKey, descriptor?: { value?: unknown; }) => {
        if (typeof method !== 'string' || (/\//.test as (v: string) => v is `/${string}`)(method))
            init = path as any, path = method, method = undefined;
        if (typeof path !== 'string') {
            if (typeof propertyKey !== 'string')
                throw new TypeError();
            init = path, path = propertyKey;
        }
        $Controller.from(constructor).route(path, {
            propertyKey,
            method,
            init,
            type: descriptor?.value ? functionType(descriptor.value) : 'Static',
        });
    });
}

type ParamsOptions = {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
};

type Params<T extends Record<string, string>> = T;
function Params(options?: ParamsOptions): Decorators<'parameter' | 'parameter_constructor'>;
function Params(key: string, options?: ParamsOptions): Decorators<'parameter' | 'parameter_constructor'>;
function Params(key?: string | ParamsOptions, options?: ParamsOptions) {
    return Decorators(['parameter', 'parameter_constructor'], (target, propertyKey, parameterIndex) => {
        if (typeof key !== 'string')
            options = key, key = undefined;
        setParamType(target, propertyKey, parameterIndex, {
            ...options,
            identifier: 'params',
            key,
        });
    });
}
register('params', Params);

type Body<T = unknown> = T;
function Body(options?: ParamsOptions): Decorators<'parameter' | 'parameter_constructor'>;
function Body(key: string, options?: ParamsOptions): Decorators<'parameter' | 'parameter_constructor'>;
function Body(key?: string | ParamsOptions, options?: ParamsOptions) {
    return Decorators(['parameter', 'parameter_constructor'], (target, propertyKey, parameterIndex) => {
        if (typeof key !== 'string')
            options = key, key = undefined;
        setParamType(target, propertyKey, parameterIndex, {
            ...options,
            identifier: 'body',
            key,
        });
    });
}
register('body', Body);

type Query<T extends Record<string, string | string[]> = Record<string, string | string[]>> = T;
function Query(options?: ParamsOptions): Decorators<'parameter' | 'parameter_constructor'>;
function Query(key: string, options?: ParamsOptions): Decorators<'parameter' | 'parameter_constructor'>;
function Query(key?: string | ParamsOptions, options?: ParamsOptions) {
    return Decorators(['parameter', 'parameter_constructor'], (target, propertyKey, parameterIndex) => {
        if (typeof key !== 'string')
            options = key, key = undefined;
        setParamType(target, propertyKey, parameterIndex, {
            ...options,
            identifier: 'query',
            key,
        });
    });
}
register('query', Query);

type RequestUrl = URL;
const RequestUrl = register('url');

type Server = import('bun').Server;
const Server = register('server');

type ResponseInit = { readonly headers: Record<string, string>, status?: number, statusText?: string; };
const ResponseInit = register('responseInit');

type Store<T extends Record<any, any>> = T;
function Store(key?: string) {
    return Decorators(['parameter', 'parameter_constructor'], (target, propertyKey, parameterIndex) => {
        setParamType(target, propertyKey, parameterIndex, {
            identifier: 'store',
            key,
            schema: false,
        });
    });
}
register('store', Store);

type RawResponse<T = unknown> = T;
const RawResponse = register('rawResponse');

register('response', Response);

register('request', Request);

type Cookie = Bun.CookieMap;
const Cookie = register('cookie');

export {
    Controller,
    Injectable,
    Inject,
    Use,
    Hook,
    Route,
    Params,
    Body,
    Query,
    RequestUrl,
    Server,
    ResponseInit,
    Store,
    RawResponse,
    Cookie,
};
