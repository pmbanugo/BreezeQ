import { JQPBroker } from "../broker.js";
import { JQPWorker } from "../worker.js";
import { MemoryPersistence } from "../memory_persistence.js";
import { BrokerConfig } from "../types.js";

// Configuration
const config: BrokerConfig = {
  frontend_port: 5555,
  backend_port: 5559,
  database_path: ":memory:",
  heartbeat_interval: 2000, // 2 seconds
  liveness_factor: 3, // 6 seconds before considering peer dead
  default_job_timeout: 60000, // 60 seconds
  default_retry_count: 3,
};

async function runBrokerRestartDemo() {
  console.log("=== Broker Restart Demo ===");
  console.log("This demo shows how workers handle broker restarts and reconnection");
  console.log();

  // Create persistence layer (shared between broker instances)
  const persistence = new MemoryPersistence();
  
  // Add some dummy jobs to show recovery
  console.log("Adding some dummy jobs to persistence...");
  await persistence.add({
    job_type: "data.process",
    payload: '{"input": "test1"}',
    options: { retries: 3 },
    status: "processing",
  });
  
  await persistence.add({
    job_type: "data.process",
    payload: '{"input": "test2"}',
    options: { retries: 2 },
    status: "processing",
  });
  
  // Create and start initial broker
  let broker = new JQPBroker(config, persistence);
  await broker.start();
  
  console.log("Initial broker started");
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
  
  console.log("Workers started and connected to broker");
  
  // Monitor states
  const monitorBrokerState = () => {
    const state = broker.getState();
    console.log(`\n--- Broker State ---`);
    console.log(`Active workers: ${state.workers.size}`);
    console.log(`Ready workers for 'data.process': ${state.ready_workers.get("data.process")?.length || 0}`);
    console.log(`Processing jobs: ${state.processingJobs.size}`);
  };
  
  const monitorWorkerStates = () => {
    console.log(`\n--- Worker States ---`);
    const worker1State = worker1.getState();
    const worker2State = worker2.getState();
    console.log(`Worker1: running=${worker1State.running}, connected=${worker1State.connected}`);
    console.log(`Worker2: running=${worker2State.running}, connected=${worker2State.connected}`);
  };
  
  // Check initial state
  monitorBrokerState();
  monitorWorkerStates();
  
  // Let it run for 10 seconds
  await sleep(10000);
  
  console.log("\n🔥 Stopping broker (simulating broker crash)...");
  await broker.stop();
  
  console.log("Broker stopped. Workers should detect disconnection...");
  
  // Monitor worker states during broker downtime
  const disconnectedMonitor = setInterval(() => {
    monitorWorkerStates();
  }, 3000);
  
  // Wait for workers to detect broker failure
  await sleep(8000);
  
  console.log("\n🔄 Starting new broker instance (simulating restart)...");
  
  // Create new broker with same persistence
  broker = new JQPBroker(config, persistence);
  await broker.start();
  
  console.log("New broker started. It should recover processing jobs...");
  
  // Check job recovery
  const processingJobs = await persistence.getProcessingJobs();
  console.log(`Jobs that were processing before restart: ${processingJobs.length}`);
  
  const queuedJobs = await persistence.getQueuedJobs("data.process");
  console.log(`Jobs re-queued after restart: ${queuedJobs.length}`);
  
  clearInterval(disconnectedMonitor);
  
  // Monitor reconnection
  const reconnectionMonitor = setInterval(() => {
    monitorBrokerState();
    monitorWorkerStates();
  }, 3000);
  
  console.log("Waiting for workers to reconnect...");
  
  // Wait for workers to reconnect
  await sleep(15000);
  
  console.log("\nDemo complete. Cleaning up...");
  clearInterval(reconnectionMonitor);
  
  await worker1.stop();
  await worker2.stop();
  await broker.stop();
  
  console.log("Cleanup complete.");
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo
runBrokerRestartDemo().catch(console.error);
