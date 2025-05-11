
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
    *[Symbol.iterator]() {
        if (this.#used)
            return;
        if (!(this.#values instanceof GeneratorFunction.prototype))
            throw new TypeError('The provided value is not an instance of a generator function.');
        this.#used = true;
        yield this.#firstValue;
        yield* this.#values;
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
            const body: Record<string, ReturnType<Awaited<ReturnType<Response['formData']>>['getAll']> | ReturnType<Awaited<ReturnType<Response['formData']>>['getAll']>[number]> = {}, form = await request.formData();
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

function getStack() {
    const store = {} as { stack: string; };
    Error.captureStackTrace(store);
    const match = store.stack.match(/(?<=\(bun:wrap.+?\s+at ).*?(?=\n)/s);
    if (!match)
        return;
    return match[0];
}

export { type StreamLike, Stream, newResponse };
export { parseBody, parseQuery };
export { getMethodType, type MethodType };
export { getStack };
