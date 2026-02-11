/// <reference types="bun" />
import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

describe("Node Provider Test Bridge (Bun -> Node)", () => {
  test("node crypto test suite bridge", () => {
    const testFile = join(__dirname, "node-provider-integration.test.node.ts");

    const nodeTestSuite = spawnSync(
      "node",
      ["--import=tsx", "--test", testFile],
      {
        stdio: "inherit",
        shell: false,
        encoding: "utf-8",
      },
    );

    expect(nodeTestSuite.status).toBe(0);
  });
});
