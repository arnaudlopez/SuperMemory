import assert from "node:assert/strict";
import test from "node:test";
import { MEMORY_FABRIC_V2_ACCEPTANCE, verifyMemoryFabricV2Matrix } from "../scripts/verify-memory-fabric-v2.mjs";

test("the executable Memory Fabric v2 matrix covers exactly all 45 blueprint criteria", () => {
  const expected = [
    ...Array.from({ length: 20 }, (_, index) => `WM-AC${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 12 }, (_, index) => `KG-AC${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 7 }, (_, index) => `AD-AC${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 3 }, (_, index) => `RT-AC${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 3 }, (_, index) => `IM-AC${String(index + 1).padStart(2, "0")}`)
  ];
  assert.deepEqual(Object.keys(MEMORY_FABRIC_V2_ACCEPTANCE).sort(), expected.sort());
  assert.equal(verifyMemoryFabricV2Matrix().status, "pass");
});
