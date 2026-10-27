import "dotenv/config";
import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getR2Client, r2Bucket } from "../src/services/r2-storage.service.js";

const client = getR2Client();
const origins = (
  process.env.R2_ALLOWED_ORIGINS ||
  "https://albumo.in,https://www.albumo.in,https://admin.albumo.in,https://studio.albumo.in,http://localhost:3000,http://localhost:3001,http://localhost:3002"
)
  .split(",")
  .map((value) => new URL(value.trim()).origin);
const apply = process.argv.includes("--apply");
try {
  for (const visibility of ["public", "private"] as const) {
    const Bucket = r2Bucket(visibility);
    await client.send(new HeadBucketCommand({ Bucket }));
    const rule = {
      ID: "albumo-" + visibility,
      AllowedOrigins: [...new Set(origins)],
      AllowedMethods:
        visibility === "public" ? ["GET", "HEAD"] : ["GET", "HEAD", "PUT"],
      AllowedHeaders: [
        "content-type",
        "if-none-match",
        "cache-control",
        "range",
      ],
      ExposeHeaders: [
        "ETag",
        "Content-Length",
        "Content-Range",
        "Accept-Ranges",
      ],
      MaxAgeSeconds: 3600,
    };
    console.log(JSON.stringify({ bucket: Bucket, cors: rule }));
    if (apply) {
      const existing = await client
        .send(new GetBucketCorsCommand({ Bucket }))
        .catch((error) => {
          if (error.$metadata?.httpStatusCode === 404) return { CORSRules: [] };
          throw error;
        });
      await client.send(
        new PutBucketCorsCommand({
          Bucket,
          CORSConfiguration: {
            CORSRules: [
              ...(existing.CORSRules || []).filter(
                (item) => item.ID !== rule.ID,
              ),
              rule,
            ],
          },
        }),
      );
    }
  }
  const Bucket = r2Bucket("private");
  if (apply) {
    const current = await client
      .send(new GetBucketLifecycleConfigurationCommand({ Bucket }))
      .catch((error) => {
        if (error.$metadata?.httpStatusCode === 404) return { Rules: [] };
        throw error;
      });
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket,
        LifecycleConfiguration: {
          Rules: [
            ...(current.Rules || []).filter(
              (rule) => rule.ID !== "albumo-staging-expiry",
            ),
            {
              ID: "albumo-staging-expiry",
              Status: "Enabled",
              Filter: { Prefix: "staging/" },
              Expiration: { Days: 1 },
            },
          ],
        },
      }),
    );
  }
  console.log(
    apply
      ? "R2 CORS and private staging cleanup configured."
      : "Preview only. Add --apply to configure R2.",
  );
} catch (error) {
  console.error(
    "R2 configuration failed:",
    error instanceof Error ? error.name : "Unknown error",
  );
  process.exitCode = 1;
} finally {
  client.destroy();
}
