// Main exports for the JQP (Job Queue Protocol) implementation
export { JQPBroker } from "./broker.js";
export { JQPWorker } from "./worker.js";
export { JQPClient } from "./client.js";
export { MemoryPersistence } from "./memory_persistence.js";
export * from "./types.js";

// Default configuration
export const DEFAULT_CONFIG = {
  frontend_port: 5550,
  backend_port: 5551,
  database_path: ":memory:",
  heartbeat_interval: 2500, // 2.5 seconds
  liveness_factor: 3, // 3 * heartbeat_interval before considering peer dead
  default_job_timeout: 60000, // 60 seconds
  default_retry_count: 3,
} as const;
