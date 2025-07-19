// Main exports for the JQP (Job Queue Protocol) implementation
export { JQPBroker } from "./broker.js";
export { JQPWorker } from "./worker.js";
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
};

console.log("JQP (Job Queue Protocol) - Broker and Worker Implementation");
console.log();
console.log("Available components:");
console.log("- JQPBroker: Manages workers and handles heartbeats");
console.log("- JQPWorker: Connects to broker with heartbeat/liveness");
console.log("- Job processing by Workers <> Broker");
console.log("- MemoryPersistence: Simple in-memory job storage");
console.log();
console.log("Run examples:");
console.log("- pnpm run dev src/examples/basic_heartbeat_demo.ts");
console.log("- pnpm run dev src/examples/worker_failure_demo.ts");
console.log("- pnpm run dev src/examples/multiple_workers_demo.ts");
console.log("- pnpm run dev src/examples/broker_restart_demo.ts");
console.log("- node --import=tsx src/examples/basic_worker_broker.ts");
console.log("- node --import=tsx src/examples/job_processing_demo.ts");
console.log("- node --import=tsx src/examples/failure_scenarios.ts");
console.log();
console.log("Run tests:");
console.log("- node --test src/**/*.test.ts");
