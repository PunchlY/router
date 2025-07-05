import { Controller as $Controller, type Init, type HookType } from './controller';
import type { TSchema } from '@sinclair/typebox';
import { registerInjectable, register, setParamType, inject } from './service';
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

function Controller(opt?: { prefix?: string, headers?: Init['headers']; }) {
    return Decorators({
        class(target) {
            $Controller.from(target).init({ ...opt, init: { headers: opt?.headers } });
        },
    });
}

function Injectable(opt?: { scope?: 'SINGLETON' | 'REQUEST'; }) {
    return Decorators({
        class(target) {
            registerInjectable(target, opt?.scope !== 'REQUEST');
        },
    });
}

function Inject() {
    return Decorators({
        property(target, propertyKey) {
            inject(target, propertyKey);
        },
    });
}

function Use(controller: Function) {
    return Decorators({
        class(target) {
            $Controller.from(target).use({
                router: controller,
            });
        },
    });
}

function Hook(hook: HookType) {
    return Decorators({
        method({ constructor }, propertyKey) {
            $Controller.from(constructor).hook({ propertyKey, hook });
        },
    });
}

function Mount<Path extends string>(init?: {
    headers?: Init['headers'];
}): Decorators<'property', Path>;
function Mount(path: string, init?: {
    headers?: Init['headers'];
}): Decorators<'property'>;
function Mount(path?: string | Init, init?: Init) {
    return Decorators(['property'], (target, propertyKey) => {
        if (typeof path !== 'string') {
            if (typeof propertyKey !== 'string')
                throw new TypeError();
            init = path, path = propertyKey;
        }
        $Controller.from(target.constructor).mount({
            path,
            propertyKey,
            init: { headers: init?.headers },
        });
    });
}

function Route<Path extends string>(init?: Init): Decorators<'method' | 'property' | 'accessor', Path>;
function Route(path: `/${string}`, init?: Init): Decorators<'method' | 'property' | 'accessor'>;
function Route<Path extends string>(method: import('bun').RouterTypes.HTTPMethod, init?: Init): Decorators<'method' | 'property' | 'accessor', Path>;
function Route(method: import('bun').RouterTypes.HTTPMethod, path: string, init?: Init): Decorators<'method' | 'property' | 'accessor'>;
function Route<Path extends string>(method: Uppercase<string>, init?: Init): Decorators<'method' | 'property' | 'accessor', Path>;
function Route(method: Uppercase<string>, path: string, init?: Init): Decorators<'method' | 'property' | 'accessor'>;
function Route(method?: Uppercase<string> | `/${string}` | Init, path?: string | Init, init?: Init) {
    return Decorators(['method', 'property', 'accessor'], ({ constructor }, propertyKey, descriptor?: {
        get?: () => unknown;
        value?: unknown;
    }) => {
        if (typeof method !== 'string' || (/\//.test as (v: string) => v is `/${string}`)(method))
            init = path as any, path = method, method = undefined;
        if (typeof path !== 'string') {
            if (typeof propertyKey !== 'string')
                throw new TypeError();
            init = path, path = propertyKey;
        }
        $Controller.from(constructor).route({
            path,
            propertyKey,
            method,
            init,
            type: descriptor && 'value' in descriptor ? functionType(descriptor.value) : 'Accessor',
        });
    });
}

function Static<Path extends string>(init?: Init): Decorators<'property', Path>;
function Static(path: string, init?: Init): Decorators<'property'>;
function Static(path?: string | Init, init?: Init) {
    return Decorators(['property'], ({ constructor }, propertyKey) => {
        if (typeof path !== 'string') {
            if (typeof propertyKey !== 'string')
                throw new TypeError();
            init = path, path = propertyKey;
        }
        $Controller.from(constructor).route({
            path,
            propertyKey,
            init,
            type: 'Static',
        });
    });
}

type ParamsOptions = {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
};

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

type ResponseInit = { headers: Record<string, string>, status: number, statusText?: string; };
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

register('request', Request);

type Cookie = Bun.CookieMap;
const Cookie = register('cookie');

export {
    Controller,
    Injectable,
    Inject,
    Use,
    Hook,
    Mount,
    Route,
    Static,
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
