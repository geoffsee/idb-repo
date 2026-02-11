// idb-repo-adapter.ts
import type { KVNamespace } from "../types";
import type { StorageAdapter } from "./repo";

export interface IdbRepoAdapterConfig {
    /** A pre-built KVNamespace (memory or IndexedDB-backed). */
    kv: KVNamespace;
    /** Optional key prefix to prevent collisions across entity types. */
    prefix?: string;
}

/**
 * Creates a StorageAdapter backed by a KVNamespace from this project.
 * Pass a MemoryStorageBackend-backed KV for tests or an IndexedDB-backed KV for production.
 */
export function createIdbRepoAdapter<E extends { id: ID }, ID extends string | number>(
    config: IdbRepoAdapterConfig
): StorageAdapter<E, ID> {
    const { kv } = config;
    const prefix = config.prefix ?? '';

    const key = (id: ID): string => `${prefix}${id}`;

    /** List all keys (optionally filtered by our prefix). */
    async function allEntities(): Promise<E[]> {
        const result = await kv.list({ prefix, limit: 10000 });
        const entities: E[] = [];
        for (const k of result.keys) {
            const val = await kv.get(k.name, { type: 'json' });
            if (val != null) entities.push(val as E);
        }
        return entities;
    }

    return {
        async findById(id: ID): Promise<E | null> {
            const val = await kv.get(key(id), { type: 'json' });
            return (val as E) ?? null;
        },

        async findMany(ids: ID[]): Promise<E[]> {
            const results: E[] = [];
            for (const id of ids) {
                const val = await kv.get(key(id), { type: 'json' });
                if (val != null) results.push(val as E);
            }
            return results;
        },

        async findAll(): Promise<E[]> {
            return allEntities();
        },

        async save(entity: E): Promise<E> {
            await kv.put(key(entity.id), entity);
            return entity;
        },

        async delete(id: ID): Promise<boolean> {
            const k = key(id);
            const existed = (await kv.get(k, { type: 'json' })) != null;
            if (existed) await kv.delete(k);
            return existed;
        },

        async count(): Promise<number> {
            const all = await allEntities();
            return all.length;
        },

        async exists(id: ID): Promise<boolean> {
            return (await kv.get(key(id), { type: 'json' })) != null;
        },

        async findPaginated(params: {
            page?: number;
            size?: number;
            sort?: string | string[];
            filter?: Record<string, any>;
            withDeleted?: boolean;
        }): Promise<{ items: E[]; total: number; page: number; size: number; pages: number }> {
            const page = params.page ?? 1;
            const size = params.size ?? 20;

            let all = await allEntities();

            if (params.filter) {
                all = all.filter(item =>
                    Object.entries(params.filter!).every(([k, v]) => (item as any)[k] === v)
                );
            }

            if (params.sort) {
                const [field, dir = 'asc'] = typeof params.sort === 'string'
                    ? params.sort.split(':')
                    : [params.sort[0], 'asc'];

                all.sort((a, b) => {
                    const va = (a as any)[field as string];
                    const vb = (b as any)[field as string];
                    if (va < vb) return dir === 'desc' ? 1 : -1;
                    if (va > vb) return dir === 'desc' ? -1 : 1;
                    return 0;
                });
            }

            const total = all.length;
            const start = (page - 1) * size;
            const items = all.slice(start, start + size);

            return {
                items,
                total,
                page,
                size,
                pages: Math.ceil(total / size) || 1,
            };
        },

        async transaction<T>(fn: (adapter: StorageAdapter<E, ID>) => Promise<T>): Promise<T> {
            console.warn('[idb-repo-adapter] Transactions not supported');
            return fn(this as any);
        },

        async dispose(): Promise<void> {
            // Best-effort: list and delete all prefixed keys
            const result = await kv.list({ prefix, limit: 10000 });
            for (const k of result.keys) {
                await kv.delete(k.name);
            }
        },
    };
}
