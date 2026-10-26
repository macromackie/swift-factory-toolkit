import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const nonempty = z.string().min(1);
const commandSchema = z.tuple([nonempty]).rest(nonempty);
const expectedInfo = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
const environment = z.record(z.string(), z.string());
const stackSchema = z.object({
  command: commandSchema,
  cwd: z.string().default("."),
  ready: z.object({ url: z.url(), protocol: z.number().int() }),
  timeoutSeconds: z.number().int().positive().max(600).default(90),
  lifetimeSeconds: z.number().int().positive().max(86400).default(1800),
});
const snapshotSchema = z.object({
  target: nonempty,
  test: nonempty,
  configuration: nonempty.default("Debug"),
  buildSettings: z.array(z.string().regex(/^[A-Z0-9_]+=/)).default([]),
  expectedInfo: expectedInfo.default({}),
  attachmentPrefix: nonempty.default("snapshot-"),
  scenarios: z.record(
    nonempty,
    z.object({
      environment: environment.default({}),
      appearance: nonempty.default("light"),
      textSize: nonempty.default("large"),
    }),
  ),
});
const environmentName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);
const releaseSchema = z.object({
  environment: identifier,
  configuration: nonempty.default("Release"),
  exportOptions: nonempty,
  expectedInfo: expectedInfo.default({}),
  inspectBinary: commandSchema.optional(),
  uploadEnvironment: z
    .object({ keyID: environmentName, issuerID: environmentName, keyPath: environmentName })
    .optional(),
});
export const manifestSchema = z.object({
  version: z.literal(1),
  app: identifier,
  environment: identifier,
  root: z.string(),
  artifacts: z.string(),
  stack: stackSchema.optional(),
  ios: z
    .object({
      cwd: z.string().default("."),
      project: nonempty,
      scheme: nonempty,
      bundleID: nonempty,
      appName: nonempty,
      appTarget: nonempty.optional(),
      generate: commandSchema.optional(),
      jobs: z.number().int().min(1).max(16).default(4),
      snapshot: snapshotSchema.optional(),
      release: releaseSchema.optional(),
    })
    .optional(),
});
export const sourceSchema = z.object({
  revision: z.string().nullable(),
  dirty: z.boolean(),
  digest: nonempty,
});
export const artifactSchema = z.object({ path: nonempty, sha256: nonempty });
export const appIdentitySchema = z.object({
  bundleID: nonempty,
  version: nonempty,
  build: nonempty,
  minimumOS: nonempty,
  executable: nonempty,
  sdk: nonempty,
  xcodeBuild: nonempty,
});
export const backendSchema = z.object({
  status: z.literal("ok"),
  app: nonempty,
  environment: nonempty,
  protocol: z.number().int(),
  build: nonempty,
});
const base = z.object({
  schema: z.literal(1),
  toolkit: nonempty,
  app: nonempty,
  environment: nonempty,
  manifestHash: nonempty,
  source: sourceSchema,
  runID: nonempty.optional(),
  startedAt: nonempty.optional(),
  finishedAt: nonempty.optional(),
});
const ownedStack = base.extend({
  stage: z.literal("stack"),
  owned: z.literal(true),
  nonce: nonempty,
  lease: nonempty,
  leaseNonce: nonempty,
  deadline: nonempty,
});
export const stackReceiptSchema = z.discriminatedUnion("status", [
  base.extend({
    stage: z.literal("stack"),
    status: z.literal("reused"),
    owned: z.literal(false),
    identity: backendSchema,
  }),
  ownedStack.extend({ status: z.literal("starting") }),
  ownedStack.extend({
    status: z.literal("running"),
    owner: z.object({ pid: z.number().int().positive(), childPID: z.number().int().positive() }),
  }),
  ownedStack.extend({
    status: z.literal("stopped"),
    owner: z
      .object({ pid: z.number().int().positive(), childPID: z.number().int().positive() })
      .optional(),
  }),
]);
export const buildReceiptSchema = base.extend({
  stage: z.literal("build"),
  status: z.literal("succeeded"),
  configuration: nonempty,
  identity: appIdentitySchema,
  appArtifact: artifactSchema,
  testRunner: artifactSchema,
  xctestrun: artifactSchema,
});
const tools = z.object({ xcode: nonempty, host: nonempty });
export const archiveReceiptSchema = base.extend({
  stage: z.literal("archive"),
  status: z.literal("succeeded"),
  identity: appIdentitySchema,
  archive: artifactSchema,
  symbols: artifactSchema,
  tools,
});
export const exportReceiptSchema = base.extend({
  stage: z.literal("export"),
  status: z.literal("succeeded"),
  identity: appIdentitySchema,
  ipa: artifactSchema,
  options: artifactSchema,
  tools,
  input: z.object({
    receipt: artifactSchema,
    archive: artifactSchema,
    identity: appIdentitySchema,
    source: sourceSchema,
  }),
});
const snapshotReceiptSchema = base.extend({
  stage: z.literal("snapshot"),
  status: z.literal("succeeded"),
  backend: backendSchema,
  tools,
  device: nonempty,
  build: buildReceiptSchema,
  simulators: z.unknown(),
  screenshots: z.array(artifactSchema),
});
const uploadReceiptSchema = base.extend({
  stage: z.literal("upload"),
  status: z.literal("succeeded"),
  ipa: artifactSchema,
  identity: appIdentitySchema,
  exportReceipt: artifactSchema,
  result: nonempty,
});
const incompleteSchema = base.extend({
  stage: z.enum(["build", "snapshot", "archive", "export", "upload"]),
  status: z.enum(["running", "failed"]),
  error: z.string().optional(),
  cleanupError: z.string().optional(),
});
export const receiptSchema = z.union([
  stackReceiptSchema,
  buildReceiptSchema,
  archiveReceiptSchema,
  exportReceiptSchema,
  snapshotReceiptSchema,
  uploadReceiptSchema,
  incompleteSchema,
]);
export const leaseOwnerSchema = z.object({
  pid: z.number().int().positive(),
  nonce: nonempty,
  createdAt: nonempty,
  receipt: nonempty.optional(),
});
