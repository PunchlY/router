import 'reflect-metadata/lite';
import { bucket } from './bucket';
import { type TSchema, Type, TypeGuard } from '@sinclair/typebox';
import type { TParseOperation } from '@sinclair/typebox/value';

const BasicTypes = new Map<Function, TSchema>([
    [String, Type.String()],
    [Number, Type.Number()],
    [BigInt, Type.BigInt()],
    [Boolean, Type.Boolean()],
    [Array, Type.Array(Type.Unknown())],
]);

const registry = new WeakMap<WeakKey, string>();
const registryHash = new Set<string>();
function register(identifier: string): symbol;
function register<T extends WeakKey>(identifier: string, value?: T): T;
function register(identifier: string, value?: WeakKey) {
    if (registryHash.has(identifier))
        throw new Error('Identifier is already registered');
    if (typeof value === 'undefined')
        value = Symbol(identifier);
    else if (registry.has(value))
        throw new Error('Identifier is already registered with a different value');
    registry.set(value, identifier);
    registryHash.add(identifier);
    return value;
}

type ParamType = {
    identifier?: string;
    schema?: TSchema;
    key?: string;
    operations?: TParseOperation[];
} | (new (...args: any[]) => any);
function ParamType(type: any): ParamType {
    if (registry.has(type))
        return { identifier: registry.get(type)! };
    if (typeof type === 'function') {
        if (type === Object)
            return {};
        if (BasicTypes.has(type))
            return { schema: BasicTypes.get(type) };
        if (injectableFunctionMap.has(type))
            return type as new (...args: any[]) => any;
        return {};
    }
    if (TypeGuard.IsSchema(type))
        return { schema: type };
    return {};
}

const designRegistry = bucket(new WeakMap<object, (propertyKey?: string | symbol) => ParamType[]>(), (target: object) => bucket(new Map<string | symbol | undefined, ParamType[]>(), (propertyKey) => {
    if (typeof propertyKey === 'undefined')
        return Array.from(Reflect.getOwnMetadata('design:paramtypes', target) ?? { length: 0 }, ParamType);
    const paramTypes = Reflect.getOwnMetadata('design:paramtypes', target, propertyKey);
    if (!Array.isArray(paramTypes))
        throw new TypeError();
    return Array.from(paramTypes, ParamType);
}));

function getType(target: object, propertyKey: string | symbol) {
    return Reflect.getOwnMetadata('design:type', target, propertyKey);
}

function getParamTypes(target: object, propertyKey?: string | symbol) {
    return designRegistry(target)(propertyKey);
}

function setParamType(target: object, propertyKey: string | symbol | undefined, index: number, {
    identifier,
    key,
    schema,
    operations,
}: {
    identifier: string;
    schema?: TSchema | boolean;
    key?: string;
    operations?: TParseOperation[] | TParseOperation;
}) {
    const paramTypes = getParamTypes(target, propertyKey);

    if (index >= paramTypes.length || !paramTypes[index])
        throw new Error('Index is out of bounds for parameter types');

    const paramType = paramTypes[index];
    if (typeof paramType === 'function')
        throw new TypeError();
    if (typeof paramType.identifier === 'function')
        throw new TypeError();

    if (paramType.identifier)
        throw new Error('Parameter type identifier is already defined');

    if (typeof identifier !== 'string')
        throw new TypeError();

    if (typeof key !== 'string' && typeof key !== 'undefined')
        throw new TypeError();

    if (typeof schema === 'undefined')
        schema = paramType.schema;
    else if (typeof schema === 'boolean')
        schema = schema ? paramType.schema : undefined;
    else if (!TypeGuard.IsSchema(schema))
        throw new TypeError();

    if (typeof operations === 'undefined')
        operations = paramType.operations;
    else if (typeof operations === 'string')
        operations = [operations];
    else if (!Array.isArray(operations))
        throw new TypeError();

    paramTypes[index] = { identifier, key, schema, operations };
}

const injectableFunctionMap = new WeakMap<Function, 'SINGLETON' | 'REQUEST' | 'INSTANCE'>();

function registerInjectable(constructor: Function, scope: 'SINGLETON' | 'REQUEST' | 'INSTANCE') {
    if (typeof constructor !== 'function')
        throw new TypeError();
    if (injectableFunctionMap.has(constructor))
        throw new Error(`Constructor ${constructor.name} is already registered as injectable`);
    injectableFunctionMap.set(constructor, scope);
}
function getScope(constructor: Function) {
    return injectableFunctionMap.get(constructor);
}

const injectBucket = bucket(new WeakMap<object, Set<string | symbol>>(), () => new Set());
function inject(target: object, propertyKey: string | symbol, type: Function) {
    if (injectBucket(target).has(propertyKey))
        return;
    if (Reflect.getOwnPropertyDescriptor(target, propertyKey))
        throw new TypeError();
    injectBucket(target).add(propertyKey);
    Object.defineProperty(target, propertyKey, {
        configurable: true,
        get() {
            if (!Reflect.getOwnPropertyDescriptor(target, propertyKey)?.configurable)
                throw new TypeError();
            const value = construct(type);
            Object.defineProperty(target, propertyKey, { value });
            return value;
        },
    });
}

const construct = bucket(new WeakMap<Function, any>(), (constructor) => {
    if (injectableFunctionMap.get(constructor) !== 'SINGLETON')
        throw new TypeError();
    return Reflect.construct(constructor, getParamTypes(constructor).map((constructor): any => {
        if (typeof constructor !== 'function')
            throw new TypeError();
        return construct(constructor);
    }));
});

export { register };
export { getType, getParamTypes, setParamType };
export { construct, registerInjectable, getScope, inject };
export { ParamType };
