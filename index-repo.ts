export { createIdbRepoAdapter } from "./src/repo/idb-repo-adapter";
export type { IdbRepoAdapterConfig } from "./src/repo/idb-repo-adapter";

export {
  BaseRepository,
  EntityRepository,
  InMemoryRepository,
  SoftDeleteRepository,
} from "./src/repo/repo";

export type {
  StorageAdapter,
  StorageAdapterFactory,
  EntityOfAdapter,
  IdOfAdapter,
  EntityOf,
  IdOf,
  EntityId,
  Database,
  RepositoryMap,
  SoftDeletable,
  Page,
  PaginatedResult,
  SearchableRepository,
} from "./src/repo/repo";
