import { getController, type HTTPMethod, type RequestLifecycleHook } from './controller';
import type { TSchema } from '@sinclair/typebox';
import { setParamType, registerInjectable, register } from './service';
import type { TParseOperation } from '@sinclair/typebox/value';
import { CookieMap, type HeadersInit } from 'bun';

function decoratorTypeOf(args: IArguments): keyof DecoratorsOptions {
    const [target, propertyKey, descriptor] = args as { [Symbol.iterator](): ArrayIterator<unknown>; };
    if ((typeof target !== 'object' || target === null) && typeof target !== 'function')
        throw new TypeError();
    if (typeof propertyKey !== 'string' && typeof propertyKey !== 'symbol' && typeof propertyKey !== 'undefined')
        throw new TypeError();
    if ((typeof descriptor !== 'object' || descriptor === null) && typeof descriptor !== 'number' && typeof descriptor !== 'undefined')
        throw new TypeError();

    const staticType = <T extends string>(type: T) => typeof target === 'function' && Object.hasOwn(target, 'prototype') ? `${type}_static` as const : type;
    if (typeof descriptor === 'number')
        return typeof propertyKey === 'undefined' ? 'parameter_constructor' : staticType('parameter');
    if (typeof descriptor === 'object') {
        if ('get' in descriptor || 'set' in descriptor)
            return staticType('accessor');
        if ('value' in descriptor)
            return staticType('method');
        throw new TypeError();
    }
    if (typeof propertyKey !== 'undefined')
        return staticType('property');
    return 'class';
}

interface DecoratorsOptions {
    class?(target: Function): void;

    property?(target: Object, propertyKey: string | symbol): void;
    property_static?(target: Function, propertyKey: string | symbol): void;

    accessor?(target: Object, propertyKey: string | symbol, descriptor: { get?(): unknown, set?(value: unknown): void; }): void;
    accessor_static?(target: Function, propertyKey: string | symbol, descriptor: { get?(): unknown, set?(value: unknown): void; }): void;

    method?(target: Object, propertyKey: string | symbol, descriptor: { value?: unknown; }): void;
    method_static?(target: Function, propertyKey: string | symbol, descriptor: { value?: unknown; }): void;

    parameter?(target: Object, propertyKey: string | symbol, parameterIndex: number): void;
    parameter_static?(target: Function, propertyKey: string | symbol, parameterIndex: number): void;
    parameter_constructor?(target: Function, propertyKey: undefined, parameterIndex: number): void;
}

type IntersectionFromUnion<T> = (T extends any ? (arg: T) => void : never) extends (arg: infer P) => void ? P : never;

type Decorators<K extends keyof DecoratorsOptions> = IntersectionFromUnion<NonNullable<DecoratorsOptions[K]>>;

function Decorators<T extends DecoratorsOptions>(options: T): Decorators<keyof T & keyof DecoratorsOptions>;
function Decorators<K extends keyof DecoratorsOptions>(type: K[], fn: Decorators<K>): typeof fn;
function Decorators(options: DecoratorsOptions | (keyof DecoratorsOptions)[], fn?: Decorators<keyof DecoratorsOptions>) {
    if (Array.isArray(options)) return function (target: Function & Object, propertyKey: never, descriptor: number & TypedPropertyDescriptor<unknown>) {
        const type = decoratorTypeOf(arguments);
        if (!options.includes(type))
            throw new Error('Decorator type not found');
        fn!(target, propertyKey, descriptor);
    };
    return function (target: Function & Object, propertyKey: never, descriptor: number & Required<TypedPropertyDescriptor<unknown>>) {
        const type = decoratorTypeOf(arguments);
        if (!Object.hasOwn(options, type))
            throw new Error('Decorator type not found');
        options[decoratorTypeOf(arguments)]!(target, propertyKey, descriptor);
    };
}

function Controller(prefix?: string) {
    return Decorators({
        class(target) {
            getController(target).setPrefix(prefix);
        },
    });
}

function Injectable() {
    return Decorators({
        class(target) {
            registerInjectable(target);
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
            getController(constructor).mount(path, { propertyKey, init, value });
        },
        property({ constructor }, propertyKey) {
            getController(constructor).static(path, { propertyKey, init });
        },
    });
}

function Hook(hook: RequestLifecycleHook, init?: {
    headers?: HeadersInit;
    status?: number;
    statusText?: string;
}) {
    return Decorators(['method'], ({ constructor }, propertyKey, { value }) => {
        getController(constructor).hook({ propertyKey, hook, init, value });
    });
}

function Route(method: HTTPMethod, path: string, init?: {
    headers?: HeadersInit;
    status?: number;
    statusText?: string;
}) {
    return Decorators(['method'], ({ constructor }, propertyKey, { value }) => {
        getController(constructor).route(path, { propertyKey, method, init, value });
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

register('response', Response);

register('request', Request);

type Cookie = CookieMap;
const Cookie = register('cookie', CookieMap);

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
    Cookie,
};
