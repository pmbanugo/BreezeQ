import { JQPBroker } from "../broker.js";
import { MemoryPersistence } from "../memory_persistence.js";
import { JQPClient } from "../client.js";
import { MathWorker } from "./math_worker.js";
import { BrokerConfig } from "../types.js";

/**
 * Demonstrates various failure scenarios and recovery mechanisms
 */
async function main() {
  console.log("🔥 JQP Failure Scenarios Demo");

  const config: BrokerConfig = {
    frontend_port: 5575,
    backend_port: 5576,
    database_path: ":memory:",
    heartbeat_interval: 1000,
    liveness_factor: 2,
    default_job_timeout: 3000, // Short timeout for demo
    default_retry_count: 2,
  };

  const persistence = new MemoryPersistence();
  const broker = new JQPBroker(config, persistence);

  try {
    await broker.start();
    console.log("📡 Broker started");

    // Create client
    const client = new JQPClient(`tcp://localhost:${config.frontend_port}`);
    await client.connect();

    // Scenario 1: Worker disconnect during job processing
    console.log("\n🔥 Scenario 1: Worker disconnects during job processing");

    const worker1 = new MathWorker(`tcp://localhost:${config.backend_port}`);
    await worker1.start();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Submit a slow job
    const slowJobUuid = await client.enqueueJob({
      job_type: "math.calculate",
      payload: JSON.stringify({
        operation: "slow_add",
        numbers: [1, 2],
      }),
    });

    console.log(`📝 Submitted slow job: ${slowJobUuid}`);

    // Wait a moment then kill the worker
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log("💀 Disconnecting worker during job processing...");
    await worker1.stop();

    // Check job status - should fail and potentially retry
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const slowJobStatus = await client.getJobStatus(slowJobUuid);
    console.log(
      `   Job status after worker disconnect: ${slowJobStatus.status}`
    );

    // Scenario 2: Invalid job payload handling
    console.log("\n🔥 Scenario 2: Invalid job payload handling");

    const worker2 = new MathWorker(`tcp://localhost:${config.backend_port}`);
    await worker2.start();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const invalidJobUuid = await client.enqueueJob({
      job_type: "math.calculate",
      payload: "invalid JSON payload",
    });

    console.log(`📝 Submitted invalid job: ${invalidJobUuid}`);

    // Wait and check result
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const invalidJobStatus = await client.getJobStatus(invalidJobUuid);
    console.log(`   Invalid job status: ${invalidJobStatus.status}`);
    console.log(`   Error message: ${invalidJobStatus.result}`);

    await worker2.stop();

    // Scenario 3: No workers available
    console.log("\n🔥 Scenario 3: No workers available for job type");

    await client.enqueueJob({
      job_type: "nonexistent.service",
      payload: JSON.stringify({ data: "test" }),
    });

    console.log("   Job submitted for unknown service type");

    // Scenario 4: Multiple job processing with one failure
    console.log("\n🔥 Scenario 4: Mixed success/failure batch");

    const worker3 = new MathWorker(`tcp://localhost:${config.backend_port}`);
    await worker3.start();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const job1Uuid = await client.enqueueJob({
      job_type: "math.calculate",
      payload: JSON.stringify({
        operation: "add",
        numbers: [5, 10],
      }),
    });

    const job2Uuid = await client.enqueueJob({
      job_type: "math.calculate",
      payload: JSON.stringify({
        operation: "divide",
        numbers: [10, 0], // Division by zero
      }),
    });

    console.log(`📝 Submitted good job: ${job1Uuid}`);
    console.log(`📝 Submitted bad job: ${job2Uuid}`);

    // Wait and check results
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const job1Status = await client.getJobStatus(job1Uuid);
    const job2Status = await client.getJobStatus(job2Uuid);

    console.log(
      `   Good job result: ${job1Status.status} - ${job1Status.result}`
    );
    console.log(
      `   Bad job result: ${job2Status.status} - ${job2Status.result}`
    );

    await worker3.stop();

    // Final statistics
    console.log("\n📊 Final Statistics:");
    const allJobs = await persistence.getAllJobs();
    const stats = allJobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(stats).forEach(([status, count]) => {
      console.log(`   ${status}: ${count} jobs`);
    });

    // Cleanup
    await client.disconnect();
    await broker.stop();

    console.log("\n✨ Failure scenarios demo completed!");
  } catch (error) {
    console.error("❌ Demo error:", error);
    process.exit(1);
  }
}

main().catch(console.error);
