import type { z } from "zod";
import type {
  manifestSchema,
  receiptSchema,
  sourceSchema,
  artifactSchema,
  appIdentitySchema,
  backendSchema,
  stackReceiptSchema,
  buildReceiptSchema,
  archiveReceiptSchema,
  exportReceiptSchema,
} from "./schemas.js";

export type ManifestInput = z.input<typeof manifestSchema>;
export type Manifest = z.output<typeof manifestSchema> & {
  path: string;
  hash: string;
};
export type StackConfiguration = NonNullable<Manifest["stack"]>;
export type IOSConfiguration = NonNullable<Manifest["ios"]>;
export type SnapshotConfiguration = NonNullable<IOSConfiguration["snapshot"]>;
export type ReleaseConfiguration = NonNullable<IOSConfiguration["release"]>;
export type Command = readonly [string, ...string[]];
export type SourceIdentity = z.infer<typeof sourceSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type AppIdentity = z.infer<typeof appIdentitySchema>;
export type BackendIdentity = z.infer<typeof backendSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type StackReceipt = z.infer<typeof stackReceiptSchema>;
export type BuildReceipt = z.infer<typeof buildReceiptSchema>;
export type ArchiveReceipt = z.infer<typeof archiveReceiptSchema>;
export type ExportReceipt = z.infer<typeof exportReceiptSchema>;
export type Stage = Receipt["stage"];
export type EvidenceRun<S extends Stage> = {
  directory: string;
  receipt: {
    schema: 1;
    toolkit: string;
    stage: S;
    runID: string;
    app: string;
    environment: string;
    manifestHash: string;
    source: SourceIdentity;
    startedAt: string;
    status: "running";
  };
};
export type Lease = { path: string; nonce: string; release(): Promise<void> };
export type ToolEvidence = { xcode: string; host: string };

export type SuccessfulReceipt = Extract<Receipt, { status: "succeeded" }>;
export type SuccessfulStage = SuccessfulReceipt["stage"];
export type StageData<S extends SuccessfulStage> = Omit<
  Extract<SuccessfulReceipt, { stage: S }>,
  | "schema"
  | "toolkit"
  | "stage"
  | "runID"
  | "app"
  | "environment"
  | "manifestHash"
  | "source"
  | "startedAt"
  | "finishedAt"
  | "status"
> & { source?: SourceIdentity };
