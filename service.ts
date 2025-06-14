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
    identifier?: string | Function;
    schema?: TSchema;
    key?: string;
    operations?: TParseOperation[];
    scope?: 'SINGLETON' | 'REQUEST' | 'INSTANCE';
};
function ParamType(type: any): ParamType {
    if (registry.has(type))
        return { identifier: registry.get(type)! };
    if (typeof type === 'function') {
        if (type === Object)
            return {};
        if (BasicTypes.has(type))
            return { schema: BasicTypes.get(type) };
        if (injectableFunctionMap.has(type))
            return { identifier: type, scope: injectableFunctionMap.get(type)! };
        return {};
    }
    if (TypeGuard.IsSchema(type))
        return { schema: type };
    throw new TypeError();
}

const designRegistry = bucket(new WeakMap<object, (propertyKey?: string | symbol) => ParamType[]>(), (target: object) => bucket(new Map<string | symbol | undefined, ParamType[]>(), (propertyKey) => {
    if (typeof propertyKey === 'undefined')
        return Array.from(Reflect.getOwnMetadata('design:paramtypes', target) ?? { length: 0 }, ParamType);
    const paramTypes = Reflect.getOwnMetadata('design:paramtypes', target, propertyKey);
    if (!Array.isArray(paramTypes))
        throw new TypeError();
    return Array.from(paramTypes, ParamType);
}));

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
        schema = schema ? paramTypes[index].schema : undefined;
    else if (!TypeGuard.IsSchema(schema))
        throw new TypeError();

    if (typeof operations === 'undefined')
        operations = paramTypes[index].operations;
    else if (typeof operations === 'string')
        operations = [operations];
    else if (!Array.isArray(operations))
        throw new TypeError();

    paramTypes[index] = { identifier, key, schema, operations };
}

const injectableFunctionMap = new WeakMap<Function, 'SINGLETON' | 'REQUEST' | 'INSTANCE'>();

function registerInjectable(constructor: Function, scope: 'SINGLETON' | 'REQUEST' | 'INSTANCE') {
    injectableFunctionMap.set(constructor, scope);
}

const instanceBucket = new WeakMap<Function, any>();

function construct(constructor: Function): any {
    if (instanceBucket.has(constructor))
        return instanceBucket.get(constructor);
    const instance = Reflect.construct(constructor, getParamTypes(constructor).map((constructor) => {
        if (typeof constructor.identifier !== 'function')
            throw new TypeError();
        return construct(constructor.identifier);
    }));
    instanceBucket.set(constructor, instance);
    return instance;
}

export { register };
export { getParamTypes, setParamType };
export { construct, registerInjectable };
export type { ParamType };
