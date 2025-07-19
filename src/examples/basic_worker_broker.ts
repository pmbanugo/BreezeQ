import { JQPBroker } from "../broker.js";
import { MemoryPersistence } from "../memory_persistence.js";
import { MathWorker } from "./math_worker.js";
import { BrokerConfig } from "../types.js";

/**
 * Basic example showing worker registration and simple job processing
 */
async function main() {
  console.log("🚀 Basic Worker-Broker Example");

  const config: BrokerConfig = {
    frontend_port: 5565,
    backend_port: 5566,
    database_path: ":memory:",
    heartbeat_interval: 2500,
    liveness_factor: 3,
    default_job_timeout: 10000,
    default_retry_count: 1,
  };

  const persistence = new MemoryPersistence();
  const broker = new JQPBroker(config, persistence);

  try {
    // Start broker
    console.log("📡 Starting broker...");
    await broker.start();

    // Start worker
    console.log("👷 Starting worker...");
    const worker = new MathWorker(`tcp://localhost:${config.backend_port}`);
    await worker.start();

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check broker state
    const state = broker.getState();
    console.log(
      `✅ Broker state: ${state.workers.size} workers, ${state.ready_workers.size} job types`
    );

    // Add a simple job
    console.log("📝 Adding job...");
    const jobUuid = await broker.addJob(
      "math.calculate",
      JSON.stringify({
        operation: "add",
        numbers: [10, 20, 30],
      })
    );

    console.log(`📋 Job ${jobUuid} submitted`);

    // Wait for completion
    let completed = false;
    let attempts = 0;

    while (!completed && attempts < 10) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const job = await persistence.get(jobUuid);

      if (job?.status === "completed") {
        console.log(`✅ Job completed: ${job.result}`);
        completed = true;
      } else if (job?.status === "failed") {
        console.log(`❌ Job failed: ${job.result}`);
        completed = true;
      } else {
        console.log(`⏳ Job status: ${job?.status || "unknown"}`);
      }

      attempts++;
    }

    // Cleanup
    await worker.stop();
    await broker.stop();

    console.log("✨ Example completed!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main().catch(console.error);
