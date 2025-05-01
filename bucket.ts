
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

function instanceBucket<K, V>(map: MapLike<K, V>, constructor: new (key: NoInfer<K>) => NoInfer<V>) {
    return function (key: K): V {
        if (map.has(key))
            return map.get(key)!;
        const value = new constructor(key);
        map.set(key, value);
        return value;
    };
}

export { bucket, instanceBucket };
export type { MapLike };
