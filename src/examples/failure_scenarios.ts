import { JQPBroker } from "../broker.js";
import { MemoryPersistence } from "../memory_persistence.js";
import { MathWorker } from "./math_worker.js";
import { BrokerConfig } from "../types.js";

/**
 * Demo showing various failure scenarios and recovery mechanisms
 */
async function main() {
  console.log("🧪 JQP Failure Scenarios Demo");

  const config: BrokerConfig = {
    frontend_port: 5557,
    backend_port: 5558,
    database_path: ":memory:",
    heartbeat_interval: 1000, // Faster heartbeat for demo
    liveness_factor: 3,
    default_job_timeout: 5000, // Shorter timeout for demo
    default_retry_count: 2,
  };

  const persistence = new MemoryPersistence();
  const broker = new JQPBroker(config, persistence);

  try {
    await broker.start();
    console.log("📡 Broker started");

    // Scenario 1: Worker disconnect during job processing
    console.log("\n🔥 Scenario 1: Worker disconnects during job processing");

    const worker1 = new MathWorker(`tcp://localhost:${config.backend_port}`);
    await worker1.start();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Submit a slow job
    const slowJobUuid = await broker.addJob(
      "math.calculate",
      JSON.stringify({
        operation: "slow_add",
        numbers: [1, 2],
      })
    );

    console.log(`📝 Submitted slow job: ${slowJobUuid}`);

    // Wait a moment then kill the worker
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log("💀 Disconnecting worker during job processing...");
    await worker1.stop();

    // Start a new worker to handle the retried job
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log("🔄 Starting replacement worker...");
    const worker2 = new MathWorker(`tcp://localhost:${config.backend_port}`);
    await worker2.start();

    // Wait for job completion or timeout
    let completed = false;
    let attempts = 0;

    while (!completed && attempts < 15) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const job = await persistence.get(slowJobUuid);

      if (job?.status === "completed") {
        console.log(`✅ Job eventually completed: ${job.result}`);
        completed = true;
      } else if (job?.status === "failed") {
        console.log(`❌ Job failed after retries: ${job.result}`);
        completed = true;
      } else {
        console.log(
          `⏳ Job status: ${job?.status || "unknown"}, retries left: ${
            job?.retries_left || 0
          }`
        );
      }

      attempts++;
    }

    // Scenario 2: Invalid job request
    console.log("\n🔥 Scenario 2: Invalid job format");

    const invalidJobUuid = await broker.addJob(
      "math.calculate",
      "invalid json"
    );
    console.log(`📝 Submitted invalid job: ${invalidJobUuid}`);

    await new Promise((resolve) => setTimeout(resolve, 2000));
    const invalidJob = await persistence.get(invalidJobUuid);
    console.log(
      `📋 Invalid job result: ${invalidJob?.status} - ${invalidJob?.result}`
    );

    // Scenario 3: Worker timeout
    console.log("\n🔥 Scenario 3: Job timeout");

    // Create a job that will timeout (slow_add takes 2 seconds, but timeout is 5 seconds)
    // We'll modify timeout to be very short for this test
    await broker.addJob(
      "math.calculate",
      JSON.stringify({
        operation: "slow_add",
        numbers: [100, 200],
      }),
      { timeout: 1000 }
    ); // 1 second timeout

    console.log("📝 Submitted job with short timeout");

    // Wait for timeout to occur
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check broker state
    const state = broker.getState();
    console.log(
      `📊 Processing jobs after timeout: ${state.processingJobs.size}`
    );

    // Scenario 4: Broker restart recovery
    console.log("\n🔥 Scenario 4: Broker restart recovery");

    // Add some jobs
    const job1Uuid = await broker.addJob(
      "math.calculate",
      JSON.stringify({
        operation: "add",
        numbers: [1, 1],
      })
    );

    const job2Uuid = await broker.addJob(
      "math.calculate",
      JSON.stringify({
        operation: "multiply",
        numbers: [3, 3],
      })
    );

    console.log(`📝 Added jobs before restart: ${job1Uuid}, ${job2Uuid}`);

    // Simulate jobs being in processing state
    await persistence.update(job1Uuid, { status: "processing" });
    await persistence.update(job2Uuid, { status: "processing" });

    console.log("🔄 Simulating broker restart...");
    await broker.stop();

    // Create new broker instance
    const newBroker = new JQPBroker(config, persistence);
    await newBroker.start();

    console.log("📡 Broker restarted, checking recovery...");

    // Check if jobs were re-queued
    const recoveredJob1 = await persistence.get(job1Uuid);
    const recoveredJob2 = await persistence.get(job2Uuid);

    console.log(`📋 Job 1 status after restart: ${recoveredJob1?.status}`);
    console.log(`📋 Job 2 status after restart: ${recoveredJob2?.status}`);

    // Reconnect worker to process recovered jobs
    await worker2.stop();
    const worker3 = new MathWorker(`tcp://localhost:${config.backend_port}`);
    await worker3.start();

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const finalJob1 = await persistence.get(job1Uuid);
    const finalJob2 = await persistence.get(job2Uuid);

    console.log(`✅ Final job 1: ${finalJob1?.status} - ${finalJob1?.result}`);
    console.log(`✅ Final job 2: ${finalJob2?.status} - ${finalJob2?.result}`);

    // Show final statistics
    console.log("\n📊 Final Statistics:");
    const allJobs = await persistence.getAllJobs();
    const byStatus = allJobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    for (const [status, count] of Object.entries(byStatus)) {
      console.log(`   ${status}: ${count}`);
    }

    // Cleanup
    await worker3.stop();
    await newBroker.stop();

    console.log("\n✨ Failure scenarios demo completed!");
  } catch (error) {
    console.error("❌ Error:", error);
    await broker.stop();
    process.exit(1);
  }
}

main().catch(console.error);
