import { Route, RequestUrl, Params, Query, Store, Hook, Server, Injectable, Use, Controller, RawResponse, Inject, Body, Static, ResponseInit, Mount } from './decorators';
import { routes } from './compose';

@Injectable({ scope: 'REQUEST' })
class User {
    static uid = 0;
    constructor(
        @Params('id', { operations: [] }) public id: string,
        @Query('name', { operations: [] }) public name: string,
    ) {
        console.log('connect %s', User.uid++);
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

    @Route('GET', { status: 403 })
    declare '/*': void;

    @Route('GET')
    '/ip'(request: Request, server: Server) {
        return server.requestIP(request);
    }

    @Route('GET', { headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-powered-by': 'benchmark' } })
    '/id/:id'(user: User) {
        return `${user.id} ${user.name}`;
    }
}

@Controller()
class Logger {
    @Hook('request')
    initStore(store: Store<{ loggerTimeStart: number; }>) {
        store.loggerTimeStart = Bun.nanoseconds();
    }

    @Hook('afterResponse')
    log({ method }: Request, { pathname }: RequestUrl, { status }: ResponseInit, @Store('loggerTimeStart') loggerTimeStart: number) {
        console[status >= 200 && status < 300 ? 'debug' : 'error']('%s %d %s %fms', method, status, pathname, (Bun.nanoseconds() - loggerTimeStart) / 1000000);
    }
}

@Controller()
class JSX {
    @Hook('afterHandle')
    map(response: RawResponse, set: ResponseInit) {
        set.headers['content-type'] = 'text/html;charset=UTF-8';
        return `<body>${response}</body>`;
    }

    @Route('GET')
    '/*'() {
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

    @Static()
    '/' = 'Hi';

    @Route('OPTIONS', '/id/:id', { headers: { 'Access-Control-Allow-Methods': 'GET' } })
    declare private _id: void;

    @Route('GET', '/id/:id', { headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-powered-by': 'benchmark' } })
    id(@Params('id', { operations: [] }) id: string, @Query('name', { operations: [] }) name: string) {
        return `${id} ${name}`;
    }

    @Route('POST')
    json(body: Body) {
        return body;
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
    // routes: {
    //     '/ws'(request, server) {
    //         server.upgrade(request, {
    //             get data() {
    //                 console.log('data');
    //                 this.headers = new Headers();
    //                 return {};
    //             },
    //         });
    //     },
    // },
    // websocket: {
    //     message(ws, message) {

    //     },
    // },
});
