import { describe, test, expect, beforeEach } from 'bun:test';
import { createIdbRepoAdapter } from './idb-repo-adapter';
import { KVStorageAdapter } from '../storage-adapter';
import { MemoryStorageBackend } from '../storage-backend';
import type { KVNamespace } from '../types';

interface TestEntity {
    id: string;
    name: string;
    value: number;
    active?: boolean;
}

let kv: KVNamespace;
let adapter: ReturnType<typeof createIdbRepoAdapter<TestEntity, string>>;

describe('idb-repo-adapter', () => {
    beforeEach(async () => {
        kv = new KVStorageAdapter(new MemoryStorageBackend());
        adapter = createIdbRepoAdapter<TestEntity, string>({ kv });
    });

    test('save → findById roundtrip', async () => {
        const entity: TestEntity = {
            id: 'ent-1',
            name: 'Item A',
            value: 42,
        };

        await adapter.save(entity);
        const found = await adapter.findById('ent-1');

        expect(found).toEqual(entity);
    });

    test('findById returns null when not found', async () => {
        const found = await adapter.findById('non-existent');
        expect(found).toBeNull();
    });

    test('findAll returns all stored entities', async () => {
        const items = [
            { id: 'a1', name: 'A', value: 10 },
            { id: 'b2', name: 'B', value: 20 },
            { id: 'c3', name: 'C', value: 30 },
        ];

        await Promise.all(items.map(item => adapter.save(item)));

        const all = await adapter.findAll();
        expect(all).toHaveLength(3);
        expect(all.map(i => i.id).sort()).toEqual(['a1', 'b2', 'c3']);
    });

    test('findMany returns only requested entities', async () => {
        await adapter.save({ id: 'x1', name: 'X', value: 1 });
        await adapter.save({ id: 'x2', name: 'Y', value: 2 });
        await adapter.save({ id: 'x3', name: 'Z', value: 3 });

        const found = await adapter.findMany(['x1', 'x3', 'missing']);
        expect(found).toHaveLength(2);
        expect(found.map(e => e.id)).toEqual(expect.arrayContaining(['x1', 'x3']));
    });

    test('delete removes entity and returns true if existed', async () => {
        const entity = { id: 'del-1', name: 'DeleteMe', value: 99 };
        await adapter.save(entity);

        const existed = await adapter.delete('del-1');
        expect(existed).toBe(true);

        const after = await adapter.findById('del-1');
        expect(after).toBeNull();

        const notExisted = await adapter.delete('del-1');
        expect(notExisted).toBe(false);
    });

    test('count returns correct number of entities', async () => {
        expect(await adapter.count()).toBe(0);

        await adapter.save({ id: 'c1', name: 'One', value: 1 });
        await adapter.save({ id: 'c2', name: 'Two', value: 2 });

        expect(await adapter.count()).toBe(2);
    });

    test('exists correctly detects presence', async () => {
        expect(await adapter.exists('e-1')).toBe(false);

        await adapter.save({ id: 'e-1', name: 'Exists', value: 100 });
        expect(await adapter.exists('e-1')).toBe(true);
    });

    test('findPaginated – basic pagination without filters', async () => {
        const entities = Array.from({ length: 25 }, (_, i) => ({
            id: `p${String(i + 1).padStart(2, '0')}`,
            name: `Item ${i + 1}`,
            value: i + 1,
        }));

        await Promise.all(entities.map(e => adapter.save(e)));

        const page = await adapter.findPaginated({ page: 2, size: 10 });

        expect(page.items).toHaveLength(10);
        expect(page.total).toBe(25);
        expect(page.page).toBe(2);
        expect(page.size).toBe(10);
        expect(page.pages).toBe(3);
        expect(page.items.at(0)?.id).toBe('p11');
    });

    test('findPaginated – with filter', async () => {
        await adapter.save({ id: 'f1', name: 'Apple', value: 5, active: true });
        await adapter.save({ id: 'f2', name: 'Banana', value: 3, active: false });
        await adapter.save({ id: 'f3', name: 'Apple', value: 8, active: true });

        const result = await adapter.findPaginated({
            page: 1,
            size: 10,
            filter: { name: 'Apple', active: true },
        });

        expect(result.total).toBe(2);
        expect(result.items.map(i => i.id)).toEqual(expect.arrayContaining(['f1', 'f3']));
    });

    test('findPaginated – with sort', async () => {
        await adapter.save({ id: 's1', name: 'Zebra', value: 5 });
        await adapter.save({ id: 's2', name: 'Apple', value: 1 });
        await adapter.save({ id: 's3', name: 'Banana', value: 3 });

        const sorted = await adapter.findPaginated({
            page: 1,
            size: 10,
            sort: 'value:desc',
        });

        expect(sorted.items.map(i => i.value)).toEqual([5, 3, 1]);
    });

    test('transaction – simple usage', async () => {
        await adapter.transaction(async tx => {
            await tx.save({ id: 't1', name: 'Trans1', value: 100 });
            await tx.save({ id: 't2', name: 'Trans2', value: 200 });
        });

        expect(await adapter.findById('t1')).not.toBeNull();
        expect(await adapter.findById('t2')).not.toBeNull();
    });
});
