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
};
function ParamType(type: any): ParamType {
    if (registry.has(type))
        return { identifier: registry.get(type)! };
    if (typeof type === 'function') {
        if (type === Object)
            return {};
        if (BasicTypes.has(type))
            return { schema: BasicTypes.get(type) };
        if (isInjectable(type))
            return type;
        return {};
    }
    if (TypeGuard.IsSchema(type))
        return { schema: type };
    throw new TypeError();
}
type ParamTypes = (ParamType | Function)[];

const designRegistry = bucket(new WeakMap<object, (propertyKey?: string | symbol) => ParamTypes>(), (target: object) => bucket(new Map<string | symbol | undefined, ParamTypes>(), (propertyKey) => {
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

    if (typeof paramTypes[index] === 'function')
        throw new TypeError();

    if (index >= paramTypes.length || !paramTypes[index])
        throw new Error('Index is out of bounds for parameter types');

    if (paramTypes[index].identifier)
        throw new Error('Parameter type identifier is already defined');

    if (typeof identifier !== 'string')
        throw new TypeError();

    if (typeof key !== 'string' && typeof key !== 'undefined')
        throw new TypeError();

    if (typeof schema === 'undefined')
        schema = paramTypes[index].schema;
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

const injectableFunctionSet = new WeakSet<Function>();

function registerInjectable(constructor: Function) {
    injectableFunctionSet.add(constructor);
}
function isInjectable(constructor: Function): constructor is Function {
    return injectableFunctionSet.has(constructor);
}

const instanceBucket = new WeakMap<Function, any>();

function construct(constructor: Function): any {
    if (instanceBucket.has(constructor))
        return instanceBucket.get(constructor);
    const design = getParamTypes(constructor);
    const instance = Reflect.construct(constructor, design.map((constructor) => {
        if (typeof constructor !== 'function')
            throw new TypeError();
        return construct(constructor);
    }));
    instanceBucket.set(constructor, instance);
    return instance;
}

export { register };
export { getParamTypes, setParamType };
export { construct, registerInjectable };
export type { ParamType, ParamTypes };
