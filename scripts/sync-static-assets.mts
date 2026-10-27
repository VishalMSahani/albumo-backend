import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseArgs } from "node:util";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  getR2Client,
  publicObjectUrl,
  r2Bucket,
  PUBLIC_CACHE_CONTROL,
} from "../src/services/r2-storage.service.js";

const frontend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../frontend_album",
);
const source = path.join(frontend, "public");
const manifestPath = path.join(frontend, "src/generated/cdn-assets.json");
const types: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
export async function collectImages(
  directory: string,
  prefix = "",
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const name = prefix + entry.name;
    if (entry.isDirectory())
      result.push(
        ...(await collectImages(path.join(directory, entry.name), name + "/")),
      );
    else if (types[path.extname(name).toLowerCase()]) result.push(name);
  }
  return result.sort();
}
const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    verify: { type: "boolean", default: false },
    section: { type: "string" },
    file: { type: "string", multiple: true },
  },
});
if (values.section && !["static", "website"].includes(values.section))
  throw new Error("Section must be static or website");
const apply = values.apply;
const verify = values.verify;
const client = getR2Client();
try {
  const previous = JSON.parse(await readFile(manifestPath, "utf8"));
  const files: Record<
    string,
    { key: string; sha256: string; bytes: number; contentType: string }
  > = { ...previous.files };
  const available = await collectImages(source);
  const selected = values.file ? [...new Set(values.file)] : available;
  for (const name of selected) {
    if (!available.includes(name))
      throw new Error("Selected image must exist inside public: " + name);
  }
  for (const name of selected) {
    const body = await readFile(path.join(source, name));
    const sha256 = createHash("sha256").update(body).digest("hex");
    // Keep each image in its existing section on subsequent unscoped publishes.
    const previousSection = files["/" + name]?.key.split("/")[0];
    const section = values.section ??
      (previousSection === "website" ? "website" : "static");
    const key = section + "/" + sha256.slice(0, 20) + "/" + name;
    const contentType = types[path.extname(name).toLowerCase()]!;
    files["/" + name] = { key, sha256, bytes: body.length, contentType };
    if (apply) {
      const existing = await client
        .send(new HeadObjectCommand({ Bucket: r2Bucket("public"), Key: key }))
        .catch((error) => {
          if (error.$metadata?.httpStatusCode === 404) return null;
          throw error;
        });
      if (!existing)
        await client.send(
          new PutObjectCommand({
            Bucket: r2Bucket("public"),
            Key: key,
            Body: body,
            ContentType: contentType,
            CacheControl: PUBLIC_CACHE_CONTROL,
            Metadata: { sha256 },
            IfNoneMatch: "*",
          }),
        );
      else if (
        existing.Metadata?.sha256 !== sha256 ||
        existing.ContentLength !== body.length
      ) {
        throw new Error("Existing immutable object does not match " + name);
      }
    }
    if (verify) {
      const response = await fetch(publicObjectUrl(key), {
        signal: AbortSignal.timeout(20_000),
      });
      if (
        !response.ok ||
        !response.headers.get("cache-control")?.includes("immutable")
      )
        throw new Error("CDN verification failed for " + name);
      const bytes = await response.arrayBuffer();
      if (
        createHash("sha256").update(Buffer.from(bytes)).digest("hex") !== sha256
      )
        throw new Error("CDN bytes differ for " + name);
    }
    console.log(
      (apply ? "Ready: " : "Preview: ") + key + " (" + body.length + " bytes)",
    );
  }
  if (apply) {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    const json = JSON.stringify({ version: 1, files }, null, 2) + "\n";
    await writeFile(manifestPath, json);
    const adminManifest = path.resolve(
      frontend,
      "../admin-frontend/generated/cdn-assets.json",
    );
    await mkdir(path.dirname(adminManifest), { recursive: true });
    await writeFile(adminManifest, json);
    console.log(
      "Updated frontend CDN manifest. Commit it with the source images.",
    );
  } else
    console.log("Preview only. Use --apply --verify to publish and verify.");
} catch (error) {
  // SDK errors can include signed request details; do not dump them.
  console.error(
    "Asset sync failed:",
    error instanceof Error ? error.name : "Unknown error",
  );
  process.exitCode = 1;
} finally {
  client.destroy();
}
