import { Worker } from "node:worker_threads";
import { JQPBroker } from "../broker.js";
import { JQPWorker } from "../worker.js";
import { MemoryPersistence } from "../memory_persistence.js";
import { BrokerConfig } from "../types.js";

// Configuration
const config: BrokerConfig = {
  frontend_port: 5555,
  backend_port: 5556,
  database_path: ":memory:",
  heartbeat_interval: 2500, // 2.5 seconds
  liveness_factor: 3, // 3 * heartbeat_interval = 7.5 seconds before considering peer dead
  default_job_timeout: 60000, // 60 seconds
  default_retry_count: 3,
};

async function runBasicHeartbeatDemo() {
  console.log("=== Basic Heartbeat Demo ===");
  console.log("This demo shows basic heartbeat functionality between broker and workers");
  console.log();

  // Create persistence layer
  const persistence = new MemoryPersistence();
  
  // Create and start broker
  const broker = new JQPBroker(config, persistence);
  await broker.start();
  
  console.log("Broker started, waiting for workers...");
  await sleep(1000);
  
  // Create and start workers
  const worker1 = new JQPWorker(`tcp://localhost:${config.backend_port}`, "image.resize", {
    heartbeatInterval: config.heartbeat_interval,
    livenessFactor: config.liveness_factor,
  });
  
  const worker2 = new JQPWorker(`tcp://localhost:${config.backend_port}`, "email.send", {
    heartbeatInterval: config.heartbeat_interval,
    livenessFactor: config.liveness_factor,
  });
  
  await worker1.start();
  await worker2.start();
  
  console.log("Workers started, observing heartbeat activity...");
  
  // Monitor broker state
  const monitorInterval = setInterval(() => {
    const state = broker.getState();
    console.log(`\n--- Broker State ---`);
    console.log(`Active workers: ${state.workers.size}`);
    
    for (const [workerId, worker] of state.workers) {
      const timeSinceHeartbeat = Date.now() - worker.last_heartbeat.getTime();
      console.log(`  Worker ${workerId}: ${worker.job_type} (last heartbeat: ${timeSinceHeartbeat}ms ago)`);
    }
    
    for (const [jobType, workerIds] of state.ready_workers) {
      console.log(`  Ready workers for ${jobType}: ${workerIds.length}`);
    }
  }, 5000);
  
  // Let it run for 30 seconds
  await sleep(30000);
  
  console.log("\nDemo complete. Cleaning up...");
  clearInterval(monitorInterval);
  
  await worker1.stop();
  await worker2.stop();
  await broker.stop();
  
  console.log("Cleanup complete.");
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo
runBasicHeartbeatDemo().catch(console.error);
