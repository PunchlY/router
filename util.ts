
function decoratorTypeOf(args: IArguments) {
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

interface DecoratorsOptions<PropertyKey extends string | symbol, Value> {
    class?(target: Function): void;

    property?(target: Object, propertyKey: PropertyKey): void;
    property_static?(target: Function, propertyKey: PropertyKey): void;

    accessor?(target: Object, propertyKey: PropertyKey, descriptor: { get?(): Value, set?(value: Value): void; }): void;
    accessor_static?(target: Function, propertyKey: PropertyKey, descriptor: { get?(): Value, set?(value: Value): void; }): void;

    method?(target: Object, propertyKey: PropertyKey, descriptor: { value?: Value; }): void;
    method_static?(target: Function, propertyKey: PropertyKey, descriptor: { value?: Value; }): void;

    parameter?(target: Object, propertyKey: PropertyKey, parameterIndex: number): void;
    parameter_static?(target: Function, propertyKey: PropertyKey, parameterIndex: number): void;
    parameter_constructor?(target: Function, propertyKey: undefined, parameterIndex: number): void;
}

type IntersectionFromUnion<T> = (T extends any ? (arg: T) => void : never) extends (arg: infer P) => void ? P : never;

type DecoratorType = keyof DecoratorsOptions<string | symbol, unknown>;
type Decorators<K extends DecoratorType, PropertyKey extends string | symbol = symbol | string, Value = unknown> = IntersectionFromUnion<NonNullable<DecoratorsOptions<PropertyKey, Value>[K]>>;

function Decorators<Options extends DecoratorsOptions<PropertyKey, Value>, PropertyKey extends string | symbol, Value>(options: Options): Decorators<{ [K in keyof Options]: K extends DecoratorType ? K : never }[keyof Options], PropertyKey, Value>;
function Decorators<Type extends DecoratorType, PropertyKey extends string | symbol, Value>(type: Type[], fn: Decorators<Type, PropertyKey, Value>): Decorators<Type, PropertyKey, Value>;
function Decorators(options: DecoratorsOptions<string | symbol, unknown> | DecoratorType[], fn?: Decorators<DecoratorType>) {
    if (Array.isArray(options)) return function (target: Function & Object, propertyKey: never, descriptor: number & TypedPropertyDescriptor<unknown>) {
        const type = decoratorTypeOf(arguments);
        if (!options.includes(type))
            throw new Error('Decorator type not found');
        fn!(target, propertyKey, descriptor);
    };
    return function call(target: Function & Object, propertyKey: never, descriptor: number & Required<TypedPropertyDescriptor<unknown>>) {
        const type = decoratorTypeOf(arguments);
        if (!Object.hasOwn(options, type))
            throw new Error('Decorator type not found');
        options[type]!(target, propertyKey, descriptor);
    };
}

interface MapLike<K, V> {
    has(key: K): boolean;
    set(key: K, value: V): void;
    get(key: K): V | undefined;
}

function bucket<K, V>(map: MapLike<K, V>, cb: (key: NoInfer<K>) => NoInfer<V>) {
    return function (key: K): V {
        if (map.has(key))
            return map.get(key)!;
        const value = cb(key);
        map.set(key, value);
        return value;
    };
}

function assignHeaders(headers: Headers, init?: Record<string, string | string[]>) {
    if (!init)
        return headers;
    for (const name in init) {
        const value = init[name]!;
        if (Array.isArray(value))
            for (const e of value)
                headers.append(name, e);
        else
            headers.set(name, value);
    }
    return headers;
}

function newResponse(data: unknown, init?: {
    headers?: Record<string, string | string[]>;
    status?: number;
    statusText?: string;
}) {
    switch (typeof data) {
        case 'string':
            return new Response(data, init);
        case 'object': {
            if (data instanceof Response) {
                return new Response(data.body, {
                    headers: assignHeaders(new Headers(data.headers), init?.headers),
                    status: init?.status ?? data.status,
                    statusText: init?.statusText ?? data.statusText,
                });
            }
            if (data === null
                || data instanceof Blob
                || data instanceof ReadableStream
                || data instanceof FormData
                || data instanceof ArrayBuffer
                || data instanceof URLSearchParams
                || data instanceof FormData
                || ArrayBuffer.isView(data))
                return new Response(data as any, init);
        } break;
    }
    return Response.json(data, init);
}

function parseQuery(search: URLSearchParams) {
    const queries: Record<string, string | string[]> = {};
    for (const name of search.keys()) {
        const values = search.getAll(name);
        queries[name] = values.length === 1 ? values[0]! : values;
    }
    return queries;
}

async function parseBody(request: Request) {
    switch (request.headers.get('content-type')?.split(';', 1)?.[0]) {
        case 'application/x-www-form-urlencoded':
            return parseQuery(new URLSearchParams(await request.text()));
        case 'multipart/form-data': {
            const body: Record<string, ReturnType<Awaited<ReturnType<Response['formData']>>['getAll']> | ReturnType<Awaited<ReturnType<Response['formData']>>['getAll']>[number]> = {};
            const form = await request.formData();
            for (const key of form.keys()) {
                const value = form.getAll(key);
                body[key] = value.length === 1 ? value[0]! : value;
            }
            return body;
        }
        case 'application/json':
            return request.json();
        case 'text/plain':
            return request.text();
        case 'application/toml':
            return Bun.TOML.parse(await request.text());
    }
    throw new Error('Unsupported content type');
};

export { Decorators };
export { bucket };
export { newResponse };
export { parseBody, parseQuery };
