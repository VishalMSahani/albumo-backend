import { BlobServiceClient } from '@azure/storage-blob';

const origins = [...new Set([
  process.env.FRONTEND_URL, process.env.ADMIN_FRONTEND_URL,
  ...(process.env.CORS_ALLOWED_ORIGINS ?? '').split(','),
].filter(Boolean).map(value => new URL(value.trim()).origin))];
if (!origins.length || !process.env.AZURE_STORAGE_CONNECTION_STRING) {
  throw new Error('Set AZURE_STORAGE_CONNECTION_STRING and the production frontend/admin origins first');
}
const rule = { allowedOrigins: origins.join(','), allowedMethods: 'PUT,OPTIONS',
  allowedHeaders: 'content-type,x-ms-blob-type,x-ms-version', exposedHeaders: 'etag', maxAgeInSeconds: 3600 };
if (!process.argv.includes('--apply')) {
  console.info('Proposed Azure Blob CORS rule (existing rules will be preserved):');
  console.info(JSON.stringify(rule, null, 2));
  console.info('Run with --apply after reviewing the origins. No settings have been changed.');
} else {
  const client = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  const properties = await client.getProperties();
  const existing = properties.cors ?? [];
  const alreadyConfigured = origins.every(origin => existing.some(item =>
    item.allowedOrigins.split(',').includes(origin) && item.allowedMethods.split(',').includes('PUT') &&
    (item.allowedHeaders.includes('*') || ['content-type', 'x-ms-blob-type'].every(header => item.allowedHeaders.includes(header))),
  ));
  if (!alreadyConfigured) {
    if (existing.length >= 5) throw new Error('Azure already has five CORS rules. Merge the proposed origins into a suitable rule in Azure Portal.');
    await client.setProperties({ cors: [...existing, rule] });
  }
  console.info('Direct-upload CORS configuration is ready.');
}
