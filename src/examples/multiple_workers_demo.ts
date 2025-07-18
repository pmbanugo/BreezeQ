import { JQPBroker } from "../broker.js";
import { JQPWorker } from "../worker.js";
import { MemoryPersistence } from "../memory_persistence.js";
import { BrokerConfig } from "../types.js";

// Configuration
const config: BrokerConfig = {
  frontend_port: 5555,
  backend_port: 5558,
  database_path: ":memory:",
  heartbeat_interval: 2000, // 2 seconds
  liveness_factor: 3, // 6 seconds before considering peer dead
  default_job_timeout: 60000, // 60 seconds
  default_retry_count: 3,
};

async function runMultipleWorkersDemo() {
  console.log("=== Multiple Workers Demo ===");
  console.log("This demo shows multiple workers connecting/disconnecting and heartbeat management");
  console.log();

  // Create persistence layer
  const persistence = new MemoryPersistence();
  
  // Create and start broker
  const broker = new JQPBroker(config, persistence);
  await broker.start();
  
  console.log("Broker started");
  await sleep(1000);
  
  // Create arrays to hold workers
  const imageWorkers: JQPWorker[] = [];
  const emailWorkers: JQPWorker[] = [];
  
  // Start multiple workers for different job types
  console.log("Starting 3 image workers...");
  for (let i = 0; i < 3; i++) {
    const worker = new JQPWorker(`tcp://localhost:${config.backend_port}`, "image.resize", {
      heartbeatInterval: config.heartbeat_interval,
      livenessFactor: config.liveness_factor,
    });
    await worker.start();
    imageWorkers.push(worker);
    await sleep(500); // Stagger the starts
  }
  
  console.log("Starting 2 email workers...");
  for (let i = 0; i < 2; i++) {
    const worker = new JQPWorker(`tcp://localhost:${config.backend_port}`, "email.send", {
      heartbeatInterval: config.heartbeat_interval,
      livenessFactor: config.liveness_factor,
    });
    await worker.start();
    emailWorkers.push(worker);
    await sleep(500); // Stagger the starts
  }
  
  // Monitor broker state
  const monitorInterval = setInterval(() => {
    const state = broker.getState();
    
    console.log(`\n--- Broker State ---`);
    console.log(`Total active workers: ${state.workers.size}`);
    
    for (const [jobType, workerIds] of state.ready_workers) {
      console.log(`  Ready workers for '${jobType}': ${workerIds.length}`);
    }
    
    // Show individual worker heartbeats
    for (const [workerId, worker] of state.workers) {
      const timeSinceHeartbeat = Date.now() - worker.last_heartbeat.getTime();
      console.log(`    Worker ${workerId}: ${worker.job_type} (${timeSinceHeartbeat}ms ago)`);
    }
  }, 4000);
  
  // Let all workers run for 15 seconds
  await sleep(15000);
  
  console.log("\n🔥 Stopping 2 image workers...");
  await imageWorkers[0].stop();
  await imageWorkers[1].stop();
  
  await sleep(5000);
  
  console.log("\n🔥 Stopping 1 email worker...");
  await emailWorkers[0].stop();
  
  await sleep(5000);
  
  console.log("\n🔄 Starting 1 new image worker...");
  const newImageWorker = new JQPWorker(`tcp://localhost:${config.backend_port}`, "image.resize", {
    heartbeatInterval: config.heartbeat_interval,
    livenessFactor: config.liveness_factor,
  });
  await newImageWorker.start();
  
  await sleep(5000);
  
  console.log("\n🔄 Starting 2 new email workers...");
  const newEmailWorker1 = new JQPWorker(`tcp://localhost:${config.backend_port}`, "email.send", {
    heartbeatInterval: config.heartbeat_interval,
    livenessFactor: config.liveness_factor,
  });
  const newEmailWorker2 = new JQPWorker(`tcp://localhost:${config.backend_port}`, "email.send", {
    heartbeatInterval: config.heartbeat_interval,
    livenessFactor: config.liveness_factor,
  });
  
  await newEmailWorker1.start();
  await newEmailWorker2.start();
  
  // Let the new configuration run for 10 seconds
  await sleep(10000);
  
  console.log("\nDemo complete. Cleaning up...");
  clearInterval(monitorInterval);
  
  // Stop all remaining workers
  await imageWorkers[2].stop();
  await emailWorkers[1].stop();
  await newImageWorker.stop();
  await newEmailWorker1.stop();
  await newEmailWorker2.stop();
  await broker.stop();
  
  console.log("Cleanup complete.");
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo
runMultipleWorkersDemo().catch(console.error);
