import { Mount, Route, RequestUrl, Params, Query, Store, Hook, Server, Injectable, Use, Controller } from './decorators';
import { routes } from './compose';

@Injectable()
class DB {
    constructor() {
        console.log('db is ready');
    }
}

@Controller()
class API {
    constructor(public db: DB) {
    }

    @Route('GET', '/ip')
    test(request: Request, server: Server) {
        return server.requestIP(request);
    }
}

@Controller()
class Logger {
    @Hook('beforeHandle')
    initStore(store: Store<{ loggerTimeStart: number; }>) {
        store.loggerTimeStart = Bun.nanoseconds();
    }

    @Hook('afterHandle')
    log({ method }: Request, { pathname }: RequestUrl, { ok, status }: Response, { loggerTimeStart }: Store<{ loggerTimeStart: number; }>) {
        console[ok ? 'debug' : 'error']('%s %d %s %fms', method, status, pathname, (Bun.nanoseconds() - loggerTimeStart) / 1000000);
    }
}

@Use(Logger)
@Mount('api', API)
@Controller()
class Main {
    @Mount('/')
    index = 'Hi';

    @Route('GET', '/id/:id', {
        headers: { 'x-powered-by': 'benchmark' },
    })
    id(@Params('id', { operations: [] }) id: string, @Query('name', { operations: [] }) name: string) {
        return `${id} ${name}`;
    }

    @Route('POST', '/json')
    json(require: Request) {
        return require.json();
    }

    @Route('GET', '/stream')
    *[Symbol.iterator]() {
        const controller: ReadableStreamDefaultController = yield;
        yield 'A';
        yield 'B';
        controller.close();
        yield 'C';
    }

}

Bun.serve({
    routes: routes(Main),
    fetch(request, server) {
        return new Response(null, { status: 404 });
    },
});
