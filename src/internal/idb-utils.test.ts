import { describe, it, expect } from "bun:test";
import { promisifyRequest, waitTx } from "./idb-utils";

describe("idb-utils", () => {
  describe("promisifyRequest", () => {
    it("resolves with result on success", async () => {
      const mockReq = {
        result: "test-value",
        onsuccess: null as any,
        onerror: null as any,
      } as unknown as IDBRequest<string>;

      const promise = promisifyRequest(mockReq);
      // Simulate success
      setTimeout(() => {
        if (mockReq.onsuccess) (mockReq as any).onsuccess();
      }, 0);

      const result = await promise;
      expect(result).toBe("test-value");
    });

    it("rejects on error with error message", async () => {
      const mockReq = {
        result: undefined,
        error: new Error("Test error"),
        onsuccess: null as any,
        onerror: null as any,
      } as unknown as IDBRequest<string>;

      const promise = promisifyRequest(mockReq);
      // Simulate error
      setTimeout(() => {
        if (mockReq.onerror) (mockReq as any).onerror();
      }, 0);

      await expect(promise).rejects.toThrow("Test error");
    });

    it("rejects with fallback message when error is null", async () => {
      const mockReq = {
        result: undefined,
        error: null,
        onsuccess: null as any,
        onerror: null as any,
      } as unknown as IDBRequest<string>;

      const promise = promisifyRequest(mockReq);
      // Simulate error
      setTimeout(() => {
        if (mockReq.onerror) (mockReq as any).onerror();
      }, 0);

      await expect(promise).rejects.toThrow("IndexedDB request failed");
    });
  });

  describe("waitTx", () => {
    it("resolves on transaction complete", async () => {
      const mockTx = {
        oncomplete: null as any,
        onabort: null as any,
        onerror: null as any,
        error: null,
      } as unknown as IDBTransaction;

      const promise = waitTx(mockTx);
      // Simulate completion
      setTimeout(() => {
        if (mockTx.oncomplete) (mockTx as any).oncomplete();
      }, 0);

      await expect(promise).resolves.toBeUndefined();
    });

    it("rejects on abort", async () => {
      const mockTx = {
        oncomplete: null as any,
        onabort: null as any,
        onerror: null as any,
        error: new Error("Aborted"),
      } as unknown as IDBTransaction;

      const promise = waitTx(mockTx);
      // Simulate abort
      setTimeout(() => {
        if (mockTx.onabort) (mockTx as any).onabort();
      }, 0);

      await expect(promise).rejects.toThrow("Aborted");
    });

    it("rejects on error", async () => {
      const mockTx = {
        oncomplete: null as any,
        onabort: null as any,
        onerror: null as any,
        error: new Error("TX error"),
      } as unknown as IDBTransaction;

      const promise = waitTx(mockTx);
      // Simulate error
      setTimeout(() => {
        if (mockTx.onerror) (mockTx as any).onerror();
      }, 0);

      await expect(promise).rejects.toThrow("TX error");
    });

    it("rejects with fallback message when error is null", async () => {
      const mockTx = {
        oncomplete: null as any,
        onabort: null as any,
        onerror: null as any,
        error: null,
      } as unknown as IDBTransaction;

      const promise = waitTx(mockTx);
      // Simulate error
      setTimeout(() => {
        if (mockTx.onerror) (mockTx as any).onerror();
      }, 0);

      await expect(promise).rejects.toThrow("IndexedDB transaction failed");
    });
  });
});
