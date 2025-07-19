import { JQPBroker } from "../broker.js";
import { MemoryPersistence } from "../memory_persistence.js";
import { MathWorker } from "./math_worker.js";
import { BrokerConfig } from "../types.js";

/**
 * Comprehensive demo of job processing between broker and workers
 */
async function main() {
  console.log("🚀 Starting JQP Job Processing Demo");

  // Setup broker configuration
  const config: BrokerConfig = {
    frontend_port: 5555,
    backend_port: 5556,
    database_path: ":memory:",
    heartbeat_interval: 2500,
    liveness_factor: 3,
    default_job_timeout: 30000,
    default_retry_count: 2,
  };

  // Create persistence layer
  const persistence = new MemoryPersistence();

  // Create and start broker
  console.log("📡 Starting broker...");
  const broker = new JQPBroker(config, persistence);
  await broker.start();

  // Wait a moment for broker to start
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Create and start workers
  console.log("👷 Starting workers...");
  const workers = [
    new MathWorker(`tcp://localhost:${config.backend_port}`),
    new MathWorker(`tcp://localhost:${config.backend_port}`),
    new MathWorker(`tcp://localhost:${config.backend_port}`),
  ];

  // Start all workers
  for (const worker of workers) {
    await worker.start();
  }

  // Wait for workers to register
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log("🎯 Adding jobs to broker...");

  // Add various types of jobs
  const jobs = [
    {
      type: "math.calculate",
      payload: JSON.stringify({ operation: "add", numbers: [1, 2, 3, 4, 5] }),
      description: "Addition of numbers 1-5"
    },
    {
      type: "math.calculate", 
      payload: JSON.stringify({ operation: "multiply", numbers: [2, 3, 4] }),
      description: "Multiplication of 2, 3, 4"
    },
    {
      type: "math.calculate",
      payload: JSON.stringify({ operation: "divide", numbers: [100, 5, 2] }),
      description: "Division: 100 ÷ 5 ÷ 2"
    },
    {
      type: "math.calculate",
      payload: JSON.stringify({ operation: "slow_add", numbers: [10, 20] }),
      description: "Slow addition (simulates long-running job)"
    },
    {
      type: "math.calculate",
      payload: JSON.stringify({ operation: "subtract", numbers: [100, 30, 5] }),
      description: "Subtraction: 100 - 30 - 5"
    }
  ];

  // Submit jobs
  const jobUuids = [];
  for (const job of jobs) {
    console.log(`📝 Adding job: ${job.description}`);
    const uuid = await broker.addJob(job.type, job.payload);
    jobUuids.push({ uuid, description: job.description });
  }

  console.log("\n⏳ Waiting for jobs to complete...");

  // Monitor job completion
  let completedJobs = 0;
  const totalJobs = jobs.length;
  const startTime = Date.now();

  while (completedJobs < totalJobs) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check completed jobs
    const allJobs = await persistence.getAllJobs();
    const completed = allJobs.filter(job => job.status === "completed" || job.status === "failed");
    
    if (completed.length > completedJobs) {
      const newCompletions = completed.slice(completedJobs);
      
      for (const job of newCompletions) {
        const jobInfo = jobUuids.find(j => j.uuid === job.uuid);
        if (job.status === "completed") {
          console.log(`✅ Job completed: ${jobInfo?.description || job.uuid}`);
          console.log(`   Result: ${job.result}`);
        } else {
          console.log(`❌ Job failed: ${jobInfo?.description || job.uuid}`);
          console.log(`   Error: ${job.result}`);
        }
      }
      
      completedJobs = completed.length;
    }

    // Show broker state
    const state = broker.getState();
    console.log(`📊 Status: ${completedJobs}/${totalJobs} completed, ${state.processingJobs.size} processing, ${state.workers.size} workers connected`);
  }

  const endTime = Date.now();
  console.log(`\n🎉 All jobs completed in ${endTime - startTime}ms!`);

  // Test job failure scenario
  console.log("\n🧪 Testing job failure scenario...");
  try {
    const failureJobUuid = await broker.addJob("math.calculate", JSON.stringify({ 
      operation: "divide", 
      numbers: [10, 0] // Division by zero
    }));
    
    // Wait for failure
    await new Promise(resolve => setTimeout(resolve, 2000));
    const failedJob = await persistence.get(failureJobUuid);
    if (failedJob?.status === "failed") {
      console.log(`❌ Job failed as expected: ${failedJob.result}`);
    }
  } catch (error) {
    console.log(`❌ Job failure test completed: ${error}`);
  }

  // Test invalid job type
  console.log("\n🧪 Testing invalid job type...");
  try {
    await broker.addJob("invalid.job.type", JSON.stringify({ data: "test" }));
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log("⚠️  Invalid job type added but no workers available to process");
  } catch (error) {
    console.log(`❌ Invalid job type test: ${error}`);
  }

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
  console.log("\n🧹 Cleaning up...");
  
  for (const worker of workers) {
    await worker.stop();
  }
  
  await broker.stop();
  
  console.log("✨ Demo completed successfully!");
}

// Run the demo
main().catch(console.error);
