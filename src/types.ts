// Job Queue Protocol (JQP) Types

// Protocol constants
export const JQP_CLIENT_PROTOCOL = "JQPC01" as const;
export const JQP_WORKER_PROTOCOL = "JQPW01" as const;

// Command codes
export const JQP_CLIENT_COMMANDS: {
  readonly ENQUEUE: Buffer;
  readonly ENQUEUE_REPLY: Buffer;
  readonly STATUS: Buffer;
  readonly STATUS_REPLY: Buffer;
} = {
  ENQUEUE: Buffer.from([0x01]),
  ENQUEUE_REPLY: Buffer.from([0x02]),
  STATUS: Buffer.from([0x03]),
  STATUS_REPLY: Buffer.from([0x04]),
} as const;

export const JQP_WORKER_COMMANDS: {
  readonly READY: Buffer;
  readonly HEARTBEAT: Buffer;
  readonly DISCONNECT: Buffer;
  readonly JOB_REQUEST: Buffer;
  readonly JOB_REPLY: Buffer;
} = {
  READY: Buffer.from([0x01]),
  HEARTBEAT: Buffer.from([0x02]),
  DISCONNECT: Buffer.from([0x03]),
  JOB_REQUEST: Buffer.from([0x11]),
  JOB_REPLY: Buffer.from([0x12]),
} as const;

// Job status types
export type JobStatus = "queued" | "processing" | "completed" | "failed";

// Job options
export interface JobOptions {
  retries?: number;
  priority?: number;
  timeout?: number;
}

// Job representation
export interface Job {
  uuid: string;
  job_type: string;
  payload: string;
  options: JobOptions;
  status: JobStatus;
  result?: string;
  retries_left?: number;
  created_at: Date;
  updated_at: Date;
}

// Client Protocol Messages
export interface EnqueueRequest {
  protocol: typeof JQP_CLIENT_PROTOCOL;
  command: typeof JQP_CLIENT_COMMANDS.ENQUEUE;
  job_uuid: string;
  job_type: string;
  job_payload: string;
  options: JobOptions;
}

export interface EnqueueReply {
  protocol: typeof JQP_CLIENT_PROTOCOL;
  command: typeof JQP_CLIENT_COMMANDS.ENQUEUE_REPLY;
  status_code: number; //TODO: use a type that represent the valid status codes for such reply. They could also be represented as Buffer, to reduce converting between types.
  job_uuid: string;
}

export interface StatusRequest {
  protocol: typeof JQP_CLIENT_PROTOCOL;
  command: typeof JQP_CLIENT_COMMANDS.STATUS;
  job_uuid: string;
}

export interface StatusReply {
  protocol: typeof JQP_CLIENT_PROTOCOL;
  command: typeof JQP_CLIENT_COMMANDS.STATUS_REPLY;
  job_status: JobStatus;
  job_result?: string;
}

// Worker Protocol Messages
export interface ReadyMessage {
  protocol: typeof JQP_WORKER_PROTOCOL;
  command: typeof JQP_WORKER_COMMANDS.READY;
  job_type: string;
}

export interface HeartbeatMessage {
  protocol: typeof JQP_WORKER_PROTOCOL;
  command: typeof JQP_WORKER_COMMANDS.HEARTBEAT;
}

export interface DisconnectMessage {
  protocol: typeof JQP_WORKER_PROTOCOL;
  command: typeof JQP_WORKER_COMMANDS.DISCONNECT;
}

export interface JobRequest {
  protocol: typeof JQP_WORKER_PROTOCOL;
  command: typeof JQP_WORKER_COMMANDS.JOB_REQUEST;
  job_uuid: string;
  options: JobOptions;
  job_payload: string;
}

export interface JobReply {
  protocol: typeof JQP_WORKER_PROTOCOL;
  command: typeof JQP_WORKER_COMMANDS.JOB_REPLY;
  job_uuid: string;
  status_code: string;
  result_payload: string;
}

// Worker information
export interface WorkerInfo {
  id: string;
  job_type: string;
  last_heartbeat: Date;
  is_ready: boolean;
}

// Batch update operation for PersistenceBase
export interface BatchUpdateOperation {
  uuid: string;
  data: Partial<Job>;
}

// Result of batch update/delete operation in PersistenceBase
export interface BatchOperationResult {
  successful: number;
  failed: number;
  errors?: string[];
}

// Persistence Layer Interface
export interface PersistenceBase {
  add(job: Omit<Job, "created_at" | "updated_at">): Promise<string>;
  get(uuid: string): Promise<Job | null>;
  update(uuid: string, data: Partial<Job>): Promise<void>;
  getQueuedJobs(job_type: string): Promise<Job[]>;
  getProcessingJobs(): Promise<Job[]>;

  // Batch operations
  updateMany(operations: BatchUpdateOperation[]): Promise<BatchOperationResult>;
  deleteMany(uuids: string[]): Promise<BatchOperationResult>;
}

// Broker state
export interface BrokerState {
  workers: Map<string, WorkerInfo>;
  processingJobs: Map<string, { worker_id: string; dispatch_timestamp: Date }>;
  ready_workers: Map<string, string[]>; // job_type -> worker_ids
}

// Configuration
export interface BrokerConfig {
  frontend_port: number;
  backend_port: number;
  database_path: string;
  heartbeat_interval: number;
  liveness_factor: number;
  default_job_timeout: number;
  default_retry_count: number;
}
