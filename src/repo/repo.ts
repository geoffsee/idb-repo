// lib.ts

export type EntityId = string | number;
// ────────────────────────────────────────────────
// Core abstract repository with common patterns
// ────────────────────────────────────────────────

// storage-adapter.ts

/**
 * Minimal protocol that every storage backend must implement.
 * Keeps repository layer agnostic to the underlying technology.
 */
export interface StorageAdapter<E, ID = string | number> {
    /**
     * Retrieve one entity by ID
     */
    findById(id: ID): Promise<E | null>;

    /**
     * Retrieve multiple entities by IDs
     */
    findMany(ids: ID[]): Promise<E[]>;

    /**
     * Retrieve all entities (use with care – pagination usually preferred)
     */
    findAll(): Promise<E[]>;

    /**
     * Create or update (most implementations do upsert under the hood)
     */
    save(entity: E): Promise<E>;

    /**
     * Delete by ID – returns whether deletion actually occurred
     */
    delete(id: ID): Promise<boolean>;

    /**
     * Optional: count matching records (used for pagination metadata)
     */
    count(filter?: Record<string, any>): Promise<number>;

    /**
     * Optional: exists check (cheaper than findById in many backends)
     */
    exists(id: ID): Promise<boolean>;

    /**
     * Paginated listing with basic filtering/sorting support
     * Filter/sort format is deliberately loose – concrete adapters interpret it.
     */
    findPaginated(params: {
        page?: number;
        size?: number;
        sort?: string | string[];             // "createdAt:desc" or ["name:asc", "age:desc"]
        filter?: Record<string, any>;         // { status: "active", age: { gte: 18 } }
        withDeleted?: boolean;
    }): Promise<{
        items: E[];
        total: number;
        page: number;
        size: number;
        pages: number;
    }>;

    /**
     * Optional – transaction support
     * Return value of fn is returned from the transaction
     */
    transaction<T>(fn: (adapter: this) => Promise<T>): Promise<T>;

    /**
     * Optional – clean up / disconnect (important for tests, lambda, etc.)
     */
    dispose?(): Promise<void> | void;
}

/**
 * Factory signature – allows dynamic creation of adapters
 */
export type StorageAdapterFactory<E, ID = string | number> = (
    config: unknown,           // connection string, options, credentials, etc.
    entityName?: string        // useful for table/collection name inference
) => Promise<StorageAdapter<E, ID>> | StorageAdapter<E, ID>;

/**
 * Helper type to extract Entity & ID from an adapter
 */
export type EntityOfAdapter<A> = A extends StorageAdapter<infer E, any> ? E : never;
export type IdOfAdapter<A> = A extends StorageAdapter<any, infer ID> ? ID : never;

export abstract class BaseRepository<E, ID = EntityId> {
    protected constructor(protected readonly adapter: StorageAdapter<E, ID>) {}


    protected normalizeId(id: ID): ID {
        // Default normalization (stringify) – can be overridden by subclasses if needed
        return typeof id === 'string' ? (id as any) : (String(id) as any);
    }

    // Forward most calls directly (you can add caching, validation, events here)
    async findById(id: ID): Promise<E | null> {
        return this.adapter.findById(this.normalizeId(id));
    }

    async findAll(): Promise<E[]> {
        return this.adapter.findAll();
    }

    async findMany(ids: ID[]): Promise<E[]> {
        return this.adapter.findMany(ids.map(id => this.normalizeId(id)));
    }

    async save(entity: E): Promise<E> {
        return this.adapter.save(entity);
    }

    async delete(id: ID): Promise<boolean> {
        return this.adapter.delete(this.normalizeId(id));
    }

    async findPaginated(
        params: { page?: number; size?: number; [key: string]: unknown }
    ): Promise<PaginatedResult<E>> {
        // map your previous params shape to the new standardized one if needed
        return this.adapter.findPaginated(params as any);
    }

    // Transaction support (if adapter provides it)
    protected async inTransaction<T>(fn: () => Promise<T>): Promise<T> {
        if (typeof this.adapter.transaction === 'function') {
            return this.adapter.transaction(() => fn());
        }
        return fn(); // fallback
    }

    async dispose(): Promise<void> {
        if (typeof this.adapter.dispose === 'function') {
            await this.adapter.dispose();
        }
    }
}

// ────────────────────────────────────────────────
// Utility type that transforms a repository map into concrete instances
// ────────────────────────────────────────────────

export type Database<T extends Record<string, typeof BaseRepository>> = {
    [K in keyof T]: T[K] extends new (...args: any[]) => infer R
        ? R
        : T[K] extends { prototype: infer P }
            ? P
            : never;
};

// ────────────────────────────────────────────────
// Alternative – when repositories are already instantiated
// ────────────────────────────────────────────────

export type RepositoryMap<T> = {
    [K in keyof T]: T[K] extends BaseRepository<infer E> ? BaseRepository<E> : never;
};

// ────────────────────────────────────────────────
// Common entity-aware repository (optional stricter version)
// ────────────────────────────────────────────────

export abstract class EntityRepository<E, ID = EntityId> extends BaseRepository<E, ID> {
    // You can add common entity-specific methods here, e.g.:
    // async exists(id: ID): Promise<boolean> {
    //     return this.adapter.exists(this.normalizeId(id));
    // }
}
// ────────────────────────────────────────────────
// Helper to extract entity type from repository class
// ────────────────────────────────────────────────

export type EntityOf<R> = R extends BaseRepository<infer E> ? E : never;

export type IdOf<R> = R extends BaseRepository<any, infer ID> ? ID : never;


export interface SoftDeletable {
    deletedAt: Date | null;
}

export abstract class SoftDeleteRepository<
    E extends SoftDeletable & { id: ID },
    ID = EntityId,
> extends EntityRepository<E, ID> {
    abstract softDelete(id: ID): Promise<boolean>;
    abstract restore(id: ID): Promise<boolean>;
    abstract findActive(): Promise<E[]>;
    abstract findDeleted(): Promise<E[]>;

    protected abstract afterNotifyDelete(id: ID): void;

    async softDeleteAndNotify(id: ID): Promise<boolean> {
        const ok = await this.softDelete(id);
        if (ok) this.afterNotifyDelete(id);
        return ok;
    }
}

// TODO Important
export interface Page<T> {
    items: T[];
    total: number;
    page: number;
    size: number;
    pages: number;
}

export type PaginatedResult<T> = Page<T>;

// TODO Important
export interface SearchableRepository<E, ID = EntityId> {
    search(query: string, params?: { page?: number; size?: number }): Promise<PaginatedResult<E>>;
}

// ────────────────────────────────────────────────
// In-Memory implementation for prototyping/testing
// ────────────────────────────────────────────────

export class InMemoryRepository<E extends { id: ID }, ID extends string | number = EntityId> extends EntityRepository<E, ID> {
    protected items = new Map<ID, E>();

    constructor() {
        super(undefined as any);
    }

    async findById(id: ID): Promise<E | null> {
        return this.items.get(this.normalizeId(id)) || null;
    }

    async findAll(): Promise<E[]> {
        return Array.from(this.items.values());
    }

    async findMany(ids: ID[]): Promise<E[]> {
        return ids
            .map(id => this.items.get(this.normalizeId(id)))
            .filter((e): e is E => !!e);
    }

    async save(entity: E): Promise<E> {
        this.items.set(this.normalizeId(entity.id), entity);
        return entity;
    }

    async delete(id: ID): Promise<boolean> {
        return this.items.delete(this.normalizeId(id));
    }

    async upsert(entity: E): Promise<E> {
        return this.save(entity);
    }

    async findPaginated(params: { page?: number; size?: number; [p: string]: unknown }): Promise<PaginatedResult<E>> {
        const page = params.page || 1;
        const size = params.size || 10;
        const all = await this.findAll();
        
        // Filter out other params (simple exact match for this in-memory implementation)
        const filters = Object.entries(params).filter(([key]) => key !== 'page' && key !== 'size');
        const filtered = all.filter(item => {
            return filters.every(([key, value]) => (item as any)[key] === value);
        });

        const start = (page - 1) * size;
        const items = filtered.slice(start, start + size);
        return {
            items,
            total: filtered.length,
            page,
            size,
            pages: Math.ceil(filtered.length / size),
        };
    }
}


