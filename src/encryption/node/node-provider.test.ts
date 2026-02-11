/// <reference types="bun" />
import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import {join} from "node:path";

// Bridges node:test and bun:test
describe("Node Provider", () => {
  test("node --import=tsx --test runs successfully", () => {

      const testFile = join(__dirname, 'node-provider-integration.test.node.ts');

    const nodeTestSuite = spawnSync(
      "node",
      ["--import=tsx", "--test", testFile],
      {
        stdio: "inherit", // capture output (you can change to 'inherit' for debugging)
        shell: false,
        encoding: "utf-8",
      },
    );

    const { status: exitCode } = nodeTestSuite;
    expect(exitCode).toBe(0);
  });
});
