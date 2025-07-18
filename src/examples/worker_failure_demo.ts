import { JQPBroker } from "../broker.js";
import { JQPWorker } from "../worker.js";
import { MemoryPersistence } from "../memory_persistence.js";
import { BrokerConfig } from "../types.js";

// Configuration
const config: BrokerConfig = {
  frontend_port: 5555,
  backend_port: 5557,
  database_path: ":memory:",
  heartbeat_interval: 2000, // 2 seconds
  liveness_factor: 3, // 6 seconds before considering peer dead
  default_job_timeout: 60000, // 60 seconds
  default_retry_count: 3,
};

async function runWorkerFailureDemo() {
  console.log("=== Worker Failure Demo ===");
  console.log("This demo shows how the broker detects worker failures and handles reconnection");
  console.log();

  // Create persistence layer
  const persistence = new MemoryPersistence();
  
  // Create and start broker
  const broker = new JQPBroker(config, persistence);
  await broker.start();
  
  console.log("Broker started");
  await sleep(1000);
  
  // Create and start workers
  const worker1 = new JQPWorker(`tcp://localhost:${config.backend_port}`, "data.process", {
    heartbeatInterval: config.heartbeat_interval,
    livenessFactor: config.liveness_factor,
  });
  
  const worker2 = new JQPWorker(`tcp://localhost:${config.backend_port}`, "data.process", {
    heartbeatInterval: config.heartbeat_interval,
    livenessFactor: config.liveness_factor,
  });
  
  await worker1.start();
  await worker2.start();
  
  console.log("Two workers started for 'data.process' job type");
  
  // Monitor broker state
  const monitorInterval = setInterval(() => {
    const state = broker.getState();
    const processingCount = state.processingJobs.size;
    const readyWorkers = state.ready_workers.get("data.process")?.length || 0;
    
    console.log(`\n--- Status ---`);
    console.log(`Active workers: ${state.workers.size}`);
    console.log(`Ready workers for 'data.process': ${readyWorkers}`);
    console.log(`Processing jobs: ${processingCount}`);
    
    for (const [workerId, worker] of state.workers) {
      const timeSinceHeartbeat = Date.now() - worker.last_heartbeat.getTime();
      console.log(`  Worker ${workerId}: ready=${worker.is_ready}, heartbeat=${timeSinceHeartbeat}ms ago`);
    }
  }, 3000);
  
  // Let workers run for 10 seconds
  await sleep(10000);
  
  console.log("\n🔥 Simulating worker1 failure (stopping abruptly)...");
  // Stop worker1 abruptly without proper disconnect
  await worker1.stop();
  
  console.log("Worker1 stopped. Observing broker's failure detection...");
  
  // Wait for broker to detect the failure
  await sleep(8000);
  
  console.log("\n🔄 Starting worker1 again (simulating reconnection)...");
  const worker1Reconnected = new JQPWorker(`tcp://localhost:${config.backend_port}`, "data.process", {
    heartbeatInterval: config.heartbeat_interval,
    livenessFactor: config.liveness_factor,
  });
  
  await worker1Reconnected.start();
  console.log("Worker1 reconnected");
  
  // Let it run for another 10 seconds
  await sleep(10000);
  
  console.log("\n🔥 Simulating worker2 failure...");
  await worker2.stop();
  
  // Wait for broker to detect the failure
  await sleep(8000);
  
  console.log("\nDemo complete. Cleaning up...");
  clearInterval(monitorInterval);
  
  await worker1Reconnected.stop();
  await broker.stop();
  
  console.log("Cleanup complete.");
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo
runWorkerFailureDemo().catch(console.error);
