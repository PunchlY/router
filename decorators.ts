import { getController, type HTTPMethod, type RequestLifecycleHook } from './controller';
import type { TSchema } from '@sinclair/typebox';
import { setParamType, registerInjectable, register } from './service';
import type { TParseOperation } from '@sinclair/typebox/value';
import { type HeadersInit } from 'bun';
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

function Controller(prefix?: string) {
    return Decorators({
        class(target) {
            getController(target).setPrefix(prefix);
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

function Use(controller: Function) {
    return Decorators({
        class(target) {
            getController(target).use(getController(controller));
        },
    });
}

function Mount(path: string, controller: Function): Decorators<'class'>;
function Mount(path: string, init?: {
    headers?: HeadersInit;
    status?: number;
    statusText?: string;
}): Decorators<'property' | 'method'>;
function Mount(path: string, init?: any) {
    return Decorators({
        class(target) {
            getController(target).mountController(path, getController(init));
        },
        method({ constructor }, propertyKey, { value }) {
            getController(constructor).mount(path, { propertyKey, init, type: functionType(value), });
        },
        property({ constructor }, propertyKey) {
            getController(constructor).mount(path, { propertyKey, init, type: 'Static' });
        },
    });
}

function Hook(hook: RequestLifecycleHook, init?: {
    headers?: HeadersInit;
    status?: number;
    statusText?: string;
}) {
    return Decorators({
        method({ constructor }, propertyKey, { value }) {
            getController(constructor).hook({ propertyKey, hook, init, type: functionType(value) });
        },
    });
}

function Route(method: HTTPMethod, path: string, init?: {
    headers?: HeadersInit;
    status?: number;
    statusText?: string;
}) {
    return Decorators({
        method({ constructor }, propertyKey, { value }) {
            getController(constructor).route(path, { propertyKey, method, init, type: functionType(value), });
        },
        property({ constructor }, propertyKey) {
            getController(constructor).route(path, { propertyKey, method, init, type: 'Static' });
        },
    });
}

type Params<T extends Record<string, string>> = T;
function Params(options?: {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
}): Decorators<'parameter' | 'parameter_constructor'>;
function Params(key: string, options?: {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
}): Decorators<'parameter' | 'parameter_constructor'>;
function Params(...args: [key?: string, options?: {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
}] | [options?: {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
}]) {
    return Decorators(['parameter', 'parameter_constructor'], (target, propertyKey, parameterIndex) => {
        let [key, options] = args;
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
function Body(options?: {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
}): Decorators<'parameter' | 'parameter_constructor'>;
function Body(key: string, options?: {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
}): Decorators<'parameter' | 'parameter_constructor'>;
function Body(...args: [key?: string, options?: {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
}] | [options?: {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
}]) {
    return Decorators(['parameter', 'parameter_constructor'], (target, propertyKey, parameterIndex) => {
        let [key, options] = args;
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
function Query(options?: {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
}): Decorators<'parameter' | 'parameter_constructor'>;
function Query(key: string, options?: {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
}): Decorators<'parameter' | 'parameter_constructor'>;
function Query(...args: [key?: string, options?: {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
}] | [options?: {
    operations?: TParseOperation | TParseOperation[];
    schema?: TSchema | boolean;
}]) {
    return Decorators(['parameter', 'parameter_constructor'], (target, propertyKey, parameterIndex) => {
        let [key, options] = args;
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
    Use,
    Mount,
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
