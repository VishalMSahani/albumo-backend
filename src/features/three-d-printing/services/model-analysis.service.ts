import path from "path";
import { Box3, BufferGeometry, Matrix4, Mesh, Vector3 } from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { PrintModelFormat } from "../../../generated/prisma/client.js";

const MAX_TRIANGLES = 2_000_000;

export type ModelAnalysis = {
  format: PrintModelFormat;
  volumeMm3: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  triangleCount: number;
};

function getFormat(fileName: string): PrintModelFormat {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".stl") return "STL";
  if (extension === ".obj") return "OBJ";
  throw Object.assign(new Error("Only STL and OBJ files are supported"), { statusCode: 400 });
}

function analyzeGeometry(geometry: BufferGeometry, matrix = new Matrix4()) {
  const position = geometry.getAttribute("position");
  if (!position || position.count < 3) {
    throw Object.assign(new Error("The model does not contain printable geometry"), {
      statusCode: 400,
    });
  }

  const index = geometry.getIndex();
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  const bounds = new Box3();
  let signedVolume = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const cross = new Vector3();

  const readVertex = (vertexIndex: number, target: Vector3) => {
    target.fromBufferAttribute(position, vertexIndex).applyMatrix4(matrix);
  };

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const aIndex = index ? index.getX(offset) : offset;
    const bIndex = index ? index.getX(offset + 1) : offset + 1;
    const cIndex = index ? index.getX(offset + 2) : offset + 2;
    readVertex(aIndex, a);
    readVertex(bIndex, b);
    readVertex(cIndex, c);
    bounds.expandByPoint(a);
    bounds.expandByPoint(b);
    bounds.expandByPoint(c);
    signedVolume += a.dot(cross.crossVectors(b, c)) / 6;
  }

  return {
    triangleCount,
    volumeMm3: Math.abs(signedVolume),
    bounds,
  };
}

export function analyzeModel(buffer: Buffer, fileName: string): ModelAnalysis {
  const format = getFormat(fileName);
  let triangleCount = 0;
  let volumeMm3 = 0;
  const bounds = new Box3();

  if (format === "STL") {
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    const result = analyzeGeometry(new STLLoader().parse(arrayBuffer));
    triangleCount = result.triangleCount;
    volumeMm3 = result.volumeMm3;
    bounds.union(result.bounds);
  } else {
    const model = new OBJLoader().parse(buffer.toString("utf8"));
    model.updateMatrixWorld(true);
    model.traverse((child) => {
      if (!(child instanceof Mesh) || !(child.geometry instanceof BufferGeometry)) return;
      const result = analyzeGeometry(child.geometry, child.matrixWorld);
      triangleCount += result.triangleCount;
      volumeMm3 += result.volumeMm3;
      bounds.union(result.bounds);
    });
  }

  if (triangleCount === 0 || bounds.isEmpty()) {
    throw Object.assign(new Error("The model does not contain printable mesh data"), {
      statusCode: 400,
    });
  }
  if (triangleCount > MAX_TRIANGLES) {
    throw Object.assign(
      new Error(`The model has too many triangles. Maximum allowed: ${MAX_TRIANGLES.toLocaleString()}`),
      { statusCode: 400 },
    );
  }
  if (!Number.isFinite(volumeMm3) || volumeMm3 <= 0.1) {
    throw Object.assign(
      new Error("The model has no enclosed volume. Repair the mesh and upload it again."),
      { statusCode: 400 },
    );
  }

  const size = bounds.getSize(new Vector3());
  const dimensions = [size.x, size.y, size.z];
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0 || value > 1000)) {
    throw Object.assign(
      new Error("Model dimensions must be greater than zero and no more than 1000 mm"),
      { statusCode: 400 },
    );
  }

  return {
    format,
    volumeMm3,
    widthMm: size.x,
    heightMm: size.z,
    depthMm: size.y,
    triangleCount,
  };
}
