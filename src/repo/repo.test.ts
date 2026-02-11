import { describe, test, expect, beforeEach } from "bun:test";
import {
  BaseRepository,
  EntityRepository,
  InMemoryRepository,
  type StorageAdapter,
  type PaginatedResult,
} from "./repo";

// Simple in-memory adapter for testing BaseRepository
class TestAdapter<E extends { id: string }> implements StorageAdapter<
  E,
  string
> {
  private store = new Map<string, E>();

  async findById(id: string): Promise<E | null> {
    return this.store.get(id) ?? null;
  }

  async findMany(ids: string[]): Promise<E[]> {
    return ids.map((id) => this.store.get(id)).filter((e): e is E => !!e);
  }

  async findAll(): Promise<E[]> {
    return Array.from(this.store.values());
  }

  async save(entity: E): Promise<E> {
    this.store.set(entity.id, entity);
    return entity;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async count(): Promise<number> {
    return this.store.size;
  }

  async exists(id: string): Promise<boolean> {
    return this.store.has(id);
  }

  async findPaginated(params: {
    page?: number;
    size?: number;
    [key: string]: unknown;
  }): Promise<PaginatedResult<E>> {
    const page = params.page ?? 1;
    const size = params.size ?? 10;
    const all = await this.findAll();

    const filtered = all.filter((item) => {
      return Object.entries(params)
        .filter(([k]) => k !== "page" && k !== "size")
        .every(([k, v]) => (item as any)[k] === v);
    });

    const start = (page - 1) * size;
    const items = filtered.slice(start, start + size);

    return {
      items,
      total: filtered.length,
      page,
      size,
      pages: Math.ceil(filtered.length / size) || 1,
    };
  }

  async transaction<T>(fn: (adapter: this) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async dispose() {
    this.store.clear();
  }
}

interface TestEntity {
  id: string;
  title: string;
  score: number;
}

describe("BaseRepository", () => {
  let repo: BaseRepository<TestEntity, string>;
  let adapter: TestAdapter<TestEntity>;

  beforeEach(() => {
    adapter = new TestAdapter();
    repo = new (class extends BaseRepository<TestEntity, string> {
      constructor() {
        super(adapter);
      }
    })();
  });

  test("findById delegates to adapter", async () => {
    await adapter.save({ id: "1", title: "Test", score: 10 });
    const found = await repo.findById("1");
    expect(found?.title).toBe("Test");
  });

  test("normalizeId handles string and number ids", () => {
    // @ts-expect-error testing private method
    expect(repo.normalizeId(42)).toBe("42");
    // @ts-expect-error
    expect(repo.normalizeId("abc")).toBe("abc");
  });

  test("findPaginated passes through params", async () => {
    await Promise.all([
      adapter.save({ id: "a", title: "A", score: 5 }),
      adapter.save({ id: "b", title: "B", score: 3 }),
      adapter.save({ id: "c", title: "A", score: 8 }),
    ]);

    const page = await repo.findPaginated({
      page: 1,
      size: 2,
      title: "A",
    });

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.items.map((e) => e.score)).toEqual(
      expect.arrayContaining([5, 8]),
    );
  });

  test("inTransaction uses adapter transaction when available", async () => {
    let called = false;

    await repo["inTransaction"](async () => {
      called = true;
      await repo.save({ id: "tx1", title: "Tx", score: 99 });
    });

    expect(called).toBe(true);
    expect(await repo.findById("tx1")).not.toBeNull();
  });
});

describe("InMemoryRepository", () => {
  let repo: InMemoryRepository<TestEntity>;

  beforeEach(() => {
    repo = new InMemoryRepository<TestEntity>();
  });

  test("basic CRUD", async () => {
    const entity = { id: "im1", title: "InMem", score: 77 };
    await repo.save(entity);

    expect(await repo.findById("im1")).toEqual(entity);
    expect(await repo.findAll()).toHaveLength(1);

    await repo.delete("im1");
    expect(await repo.findById("im1")).toBeNull();
  });

  test("findPaginated with filter", async () => {
    await repo.save({ id: "p1", title: "High", score: 90 });
    await repo.save({ id: "p2", title: "Low", score: 10 });
    await repo.save({ id: "p3", title: "High", score: 85 });

    const result = await repo.findPaginated({
      page: 1,
      size: 10,
      title: "High",
    });

    expect(result.total).toBe(2);
    expect(result.items.map((e) => e.score).sort()).toEqual([85, 90]);
  });

  test("upsert is alias for save", async () => {
    const e1 = { id: "u1", title: "First", score: 1 };
    await repo.upsert(e1);
    expect((await repo.findById("u1"))?.score).toBe(1);

    const e2 = { id: "u1", title: "Updated", score: 100 };
    await repo.upsert(e2);
    expect((await repo.findById("u1"))?.score).toBe(100);
  });
});
