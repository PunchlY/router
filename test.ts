import { Mount, Route, RequestUrl, Params, Query, Store, Hook, Server, Injectable, Use, Controller, RawResponse, Inject } from './decorators';
import { routes } from './compose';

@Injectable({ scope: 'REQUEST' })
class User {
    constructor(
        @Params('id', { operations: [] }) public id: string,
        @Query('name', { operations: [] }) public name: string,
    ) {
        console.log('user %s %s', id, name);
    }
}

@Injectable()
class DB {
    constructor() {
        console.log('db is ready');
    }
}

@Controller()
class API {
    @Inject()
    readonly db!: DB;

    @Route('GET', '/ip')
    test(request: Request, server: Server) {
        return server.requestIP(request);
    }
    @Route('GET', '/id/:id', {
        headers: { 'x-powered-by': 'benchmark' },
    })
    id(user: User) {
        return `${user.id} ${user.name}`;
    }
}

@Controller()
class Logger {
    @Hook('beforeHandle')
    initStore(store: Store<{ loggerTimeStart: number; }>) {
        store.loggerTimeStart = Bun.nanoseconds();
    }

    @Hook('afterHandle')
    log({ method }: Request, { pathname }: RequestUrl, { body, ok, status }: Response, { loggerTimeStart }: Store<{ loggerTimeStart: number; }>) {
        console[ok ? 'debug' : 'error']('%s %d %s %fms', method, status, pathname, (Bun.nanoseconds() - loggerTimeStart) / 1000000);
    }
}

@Controller()
class JSX {
    @Hook('mapResponse', { headers: { 'content-type': 'text/html;charset=UTF-8' } })
    map(response: RawResponse) {
        return `<body>${response}</body>`;
    }

    @Route('GET', '/')
    jsx() {
        return {
            $$typeof: Symbol.for('react.transitional.element'),
            toString() {
                return '<h1>JSX</h1>';
            }
        };
    }
}

@Use(Logger)
@Controller()
class Main {

    @Mount()
    readonly api!: API;
    @Mount()
    readonly jsx!: JSX;

    @Mount('/')
    index = 'Hi';

    @Route('OPTIONS', '/id/:id', {
        headers: {
            'Access-Control-Allow-Methods': 'GET',
        },
    })
    declare _id: void;

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
        yield 'A';
        yield 'B';
        yield 'C';
    }
}

Bun.serve({
    routes: routes(Main),
    fetch(request, server) {
        return new Response(null, { status: 404 });
    },
});
