import assert from "node:assert/strict";
import { analyzeModel } from "../features/three-d-printing/services/model-analysis.service.js";

const tetrahedron = `solid tetrahedron
facet normal 0 0 -1
outer loop
vertex 0 0 0
vertex 0 10 0
vertex 10 0 0
endloop
endfacet
facet normal 0 -1 0
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 0 10
endloop
endfacet
facet normal -1 0 0
outer loop
vertex 0 0 0
vertex 0 0 10
vertex 0 10 0
endloop
endfacet
facet normal 1 1 1
outer loop
vertex 10 0 0
vertex 0 10 0
vertex 0 0 10
endloop
endfacet
endsolid tetrahedron`;

const result = analyzeModel(Buffer.from(tetrahedron), "tetrahedron.stl");

assert.equal(result.format, "STL");
assert.equal(result.triangleCount, 4);
assert.equal(result.widthMm, 10);
assert.equal(result.heightMm, 10);
assert.equal(result.depthMm, 10);
assert.ok(Math.abs(result.volumeMm3 - 166.67) < 0.01);

console.log("3D model analysis verified", result);
