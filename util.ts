
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

const AsyncFunction = async function () { }.constructor as FunctionConstructor;
const AsyncGeneratorFunction = async function* () { }.constructor as AsyncGeneratorFunctionConstructor;
const GeneratorFunction = function* () { }.constructor as GeneratorFunctionConstructor;
type MethodType = ReturnType<typeof getMethodType>;

type StreamLike = IterableIterator<string | ArrayBuffer | ArrayBufferView<ArrayBufferLike>> | AsyncIterableIterator<string | ArrayBuffer | ArrayBufferView<ArrayBufferLike>>;
class Stream {
    #firstValue;
    #values;
    #used = false;
    constructor(firstValue: string | ArrayBuffer | ArrayBufferView, values: StreamLike) {
        this.#firstValue = firstValue;
        this.#values = values;
    }
    async *[Symbol.asyncIterator]() {
        if (this.#used)
            return;
        this.#used = true;
        yield this.#firstValue;
        yield* this.#values;
    }
}

function newResponse(data: unknown, init?: {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
}) {
    switch (typeof data) {
        case 'string':
            return new Response(data, init);
        case 'object':
            if (data instanceof Response) {
                const newHeaders = new Headers(data.headers);
                for (const name in init?.headers)
                    newHeaders.set(name, init.headers[name]!);
                return new Response(data.body, {
                    headers: newHeaders,
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
                || data instanceof Stream
                || ArrayBuffer.isView(data))
                return new Response(data as any, init);
            break;
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
    switch (request.headers.get('content-type')?.split(';', 1)?.[0] ?? '') {
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

function getMethodType(value: unknown) {
    if (typeof value !== 'function')
        throw new TypeError();
    if (value instanceof AsyncGeneratorFunction)
        return 'AsyncGeneratorFunction';
    if (value instanceof GeneratorFunction)
        return 'GeneratorFunction';
    if (value instanceof AsyncFunction)
        return 'AsyncFunction';
    return 'Function';
}

export { Decorators };
export { type StreamLike, Stream, newResponse };
export { parseBody, parseQuery };
export { getMethodType, type MethodType };
