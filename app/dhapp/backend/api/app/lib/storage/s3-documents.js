'use strict';

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET_NAME = process.env.DOCUMENTS_BUCKET_NAME;
const AWS_REGION  = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-central-2';

// Presigned GET URL validity — 1 hour; requires a fresh backend auth request each time.
const PRESIGNED_GET_EXPIRES_IN = 60 * 60;

let _client = null;
function getS3Client() {
  if (!_client) {
    _client = new S3Client({ region: AWS_REGION });
  }
  return _client;
}

/**
 * Derives the S3 key prefix for a patient.
 * Structure: tenants/<tenantId>/patients/<patientId>/
 */
function buildPatientPrefix(tenantId, patientId) {
  return `tenants/${tenantId}/patients/${patientId}/`;
}

/**
 * Builds the full S3 object key for a patient file.
 */
function buildFileKey(tenantId, patientId, filename) {
  return `${buildPatientPrefix(tenantId, patientId)}${filename}`;
}

/**
 * Uploads a file buffer to S3.
 * @param {string} tenantId
 * @param {string} patientId
 * @param {string} filename  - sanitized filename
 * @param {Buffer} buffer    - file content
 * @param {string} contentType
 */
async function uploadPatientFile(tenantId, patientId, filename, buffer, contentType) {
  if (!BUCKET_NAME) throw new Error('DOCUMENTS_BUCKET_NAME environment variable not set');
  const key = buildFileKey(tenantId, patientId, filename);
  await getS3Client().send(new PutObjectCommand({
    Bucket:      BUCKET_NAME,
    Key:         key,
    Body:        buffer,
    ContentType: contentType || 'application/octet-stream',
  }));
  return key;
}

/**
 * Lists all files for a patient.
 * @returns {Array<{name: string, key: string, size: number, lastModified: Date, type: string}>}
 */
async function listPatientFiles(tenantId, patientId) {
  if (!BUCKET_NAME) throw new Error('DOCUMENTS_BUCKET_NAME environment variable not set');
  const prefix = buildPatientPrefix(tenantId, patientId);
  const results = [];
  let continuationToken;

  do {
    const resp = await getS3Client().send(new ListObjectsV2Command({
      Bucket:            BUCKET_NAME,
      Prefix:            prefix,
      ContinuationToken: continuationToken,
    }));

    for (const obj of (resp.Contents || [])) {
      const relName = obj.Key.slice(prefix.length);
      if (!relName) continue; // skip folder placeholder if any
      const ext = relName.split('.').pop().toLowerCase();
      let type = 'other';
      if (['jpg','jpeg','png','gif','bmp','webp'].includes(ext)) type = 'image';
      else if (ext === 'pdf') type = 'pdf';
      else if (['txt','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp'].includes(ext)) type = 'office';

      results.push({ name: relName, key: obj.Key, size: obj.Size, lastModified: obj.LastModified, type });
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : null;
  } while (continuationToken);

  return results;
}

/**
 * Generates a presigned GET URL for a specific file.
 * URL is valid for PRESIGNED_GET_EXPIRES_IN seconds.
 * Caller must have a valid backend session to obtain this URL.
 * @param {string} s3Key  - full S3 object key
 * @returns {string} presigned URL
 */
async function generatePresignedGetUrl(s3Key) {
  if (!BUCKET_NAME) throw new Error('DOCUMENTS_BUCKET_NAME environment variable not set');
  const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
  return getSignedUrl(getS3Client(), command, { expiresIn: PRESIGNED_GET_EXPIRES_IN });
}

/**
 * Deletes a specific file from S3.
 * @param {string} s3Key  - full S3 object key
 */
async function deletePatientFile(s3Key) {
  if (!BUCKET_NAME) throw new Error('DOCUMENTS_BUCKET_NAME environment variable not set');
  await getS3Client().send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }));
}

/**
 * Checks if an S3 object exists.
 * @returns {boolean}
 */
async function patientFileExists(s3Key) {
  if (!BUCKET_NAME) return false;
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

/**
 * Returns true when S3 document storage is configured (env var present).
 */
function isS3Configured() {
  return Boolean(BUCKET_NAME);
}

module.exports = {
  buildPatientPrefix,
  buildFileKey,
  uploadPatientFile,
  listPatientFiles,
  generatePresignedGetUrl,
  deletePatientFile,
  patientFileExists,
  isS3Configured,
  BUCKET_NAME: () => BUCKET_NAME,
};
