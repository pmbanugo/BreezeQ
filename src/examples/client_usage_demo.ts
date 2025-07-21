import { JQPClient } from "../client.js";
import { JQPBroker } from "../broker.js";
import { MemoryPersistence } from "../memory_persistence.js";
import { MathWorker } from "./math_worker.js";
import { BrokerConfig } from "../types.js";

// Email worker for demonstration
class EmailWorker extends MathWorker {
  constructor(brokerAddress: string) {
    super(brokerAddress, "email.send");
  }

  protected async processJob(payload: string): Promise<string> {
    const emailData = JSON.parse(payload);

    // Simulate email sending delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    return JSON.stringify({
      messageId: `msg_${Date.now()}`,
      to: emailData.to,
      subject: emailData.subject,
      sentAt: new Date().toISOString(),
      status: "delivered",
    });
  }
}

/**
 * Comprehensive demonstration of JQP Client usage patterns
 */
async function main() {
  console.log("🚀 JQP Client Usage Demo - Real-world Patterns");

  // Setup broker and workers
  const config: BrokerConfig = {
    frontend_port: 5570,
    backend_port: 5571,
    database_path: ":memory:",
    heartbeat_interval: 2500,
    liveness_factor: 3,
    default_job_timeout: 30000,
    default_retry_count: 2,
  };

  const persistence = new MemoryPersistence();
  const broker = new JQPBroker(config, persistence);

  console.log("📡 Starting broker and workers...");
  await broker.start();

  // Start multiple workers for demonstration
  const workers = [
    new MathWorker(`tcp://localhost:${config.backend_port}`),
    new MathWorker(`tcp://localhost:${config.backend_port}`),
    new EmailWorker(`tcp://localhost:${config.backend_port}`),
  ];

  for (const worker of workers) {
    await worker.start();
  }

  // Wait for workers to register
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Create client with custom configuration
  const client = new JQPClient(`tcp://localhost:${config.frontend_port}`, {
    timeout: 5000, // 5 second timeout
    maxRetries: 3, // Retry up to 3 times
    retryDelay: 1000, // 1 second between retries
  });
  await client.connect();

  try {
    console.log("\n💡 Pattern 1: Fire-and-forget job submission");
    console.log("   Use case: Background notifications, logging, analytics");

    const notificationJobId = await client.enqueueJob({
      job_type: "email.send",
      payload: JSON.stringify({
        to: "admin@company.com",
        subject: "Daily Report Generated",
        body: "Your daily report is ready for review.",
        priority: "normal",
      }),
    });

    console.log(`   ✅ Notification job queued: ${notificationJobId}`);

    console.log("\n💡 Pattern 2: Synchronous job with immediate result");
    console.log(
      "   Use case: Image processing, data transformation, calculations"
    );

    const calculationResult = await client.submitJobAndWait({
      job_type: "math.calculate",
      payload: JSON.stringify({
        operation: "add",
        numbers: [100, 250, 175, 325],
      }),
    });

    console.log(`   ✅ Calculation result: ${calculationResult}`);

    console.log("\n💡 Pattern 3: Batch processing with status monitoring");
    console.log(
      "   Use case: Bulk email sending, file processing, data import"
    );

    const batchJobs = [];
    const customerEmails = [
      { to: "customer1@example.com", subject: "Welcome to our service!" },
      { to: "customer2@example.com", subject: "Your order has shipped" },
      { to: "customer3@example.com", subject: "Monthly newsletter" },
      {
        to: "customer4@example.com",
        subject: "Special promotion just for you",
      },
    ];

    console.log(`   📧 Submitting ${customerEmails.length} email jobs...`);

    for (const email of customerEmails) {
      const jobId = await client.enqueueJob({
        job_type: "email.send",
        payload: JSON.stringify(email),
        options: {
          priority: 5,
          retries: 2,
        },
      });
      batchJobs.push(jobId);
    }

    // Monitor batch progress
    console.log("   📊 Monitoring batch progress...");
    let completed = 0;
    let failed = 0;

    while (completed + failed < batchJobs.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      for (const jobId of batchJobs) {
        const status = await client.getJobStatus(jobId);
        if (status.status === "completed") {
          completed++;
          const result = JSON.parse(status.result || "{}");
          console.log(
            `   ✅ Email sent to ${result.to} (ID: ${result.messageId})`
          );
        } else if (status.status === "failed") {
          failed++;
          console.log(`   ❌ Email failed: ${status.result}`);
        }
      }
    }

    console.log(
      `   📈 Batch completed: ${completed} successful, ${failed} failed`
    );

    console.log("\n💡 Pattern 4: Concurrent job processing");
    console.log("   Use case: Parallel data processing, concurrent API calls");

    const concurrentJobs = [
      {
        description: "Calculate order total",
        request: {
          job_type: "math.calculate",
          payload: JSON.stringify({
            operation: "add",
            numbers: [29.99, 15.5, 8.25, 12.0], // Cart items
          }),
        },
      },
      {
        description: "Calculate tax",
        request: {
          job_type: "math.calculate",
          payload: JSON.stringify({
            operation: "multiply",
            numbers: [65.74, 0.08], // Total * tax rate
          }),
        },
      },
      {
        description: "Calculate shipping",
        request: {
          job_type: "math.calculate",
          payload: JSON.stringify({
            operation: "add",
            numbers: [5.99, 2.5], // Base shipping + handling
          }),
        },
      },
    ];

    console.log("   🔄 Starting concurrent calculations...");
    const startTime = Date.now();

    const concurrentResults = await Promise.all(
      concurrentJobs.map(async (job) => {
        const result = await client.submitJobAndWait(job.request);
        return { description: job.description, result: parseFloat(result) };
      })
    );

    const endTime = Date.now();
    console.log(`   ⚡ All calculations completed in ${endTime - startTime}ms`);

    concurrentResults.forEach((result) => {
      console.log(`   💰 ${result.description}: $${result.result.toFixed(2)}`);
    });

    const subtotal = concurrentResults[0].result;
    const tax = concurrentResults[1].result;
    const shipping = concurrentResults[2].result;
    const finalTotal = subtotal + tax + shipping;

    console.log(`   🧾 Final order total: $${finalTotal.toFixed(2)}`);

    console.log("\n💡 Pattern 5: Error handling and resilience");
    console.log(
      "   Use case: Handling service failures, invalid data, timeouts"
    );

    try {
      // Intentionally submit an invalid job
      await client.submitJobAndWait(
        {
          job_type: "nonexistent.service",
          payload: JSON.stringify({ data: "test" }),
        },
        1000,
        5000
      ); // Short polling and timeout
    } catch (error) {
      console.log(
        `   ⚠️  Handled error gracefully: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    try {
      // Submit job that will cause worker error
      await client.submitJobAndWait({
        job_type: "math.calculate",
        payload: JSON.stringify({
          operation: "divide",
          numbers: [10, 0], // Division by zero
        }),
      });
    } catch (error) {
      console.log(
        `   ⚠️  Worker error handled: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    console.log("\n💡 Pattern 6: Job prioritization and options");
    console.log("   Use case: VIP customers, urgent tasks, SLA management");

    const priorityJobs = [
      {
        priority: 1,
        description: "Regular customer email",
        payload: {
          to: "regular@example.com",
          subject: "Thanks for your order",
        },
      },
      {
        priority: 10,
        description: "VIP customer email",
        payload: {
          to: "vip@example.com",
          subject: "Priority support available",
        },
      },
      {
        priority: 5,
        description: "Marketing email",
        payload: { to: "subscriber@example.com", subject: "Weekly deals" },
      },
    ];

    console.log("   📋 Submitting jobs with different priorities...");

    for (const job of priorityJobs) {
      const jobId = await client.enqueueJob({
        job_type: "email.send",
        payload: JSON.stringify(job.payload),
        options: {
          priority: job.priority,
          retries: 1,
          timeout: 10000,
        },
      });

      console.log(
        `   📨 ${job.description} (priority ${job.priority}): ${jobId}`
      );
    }

    // Show final statistics
    console.log("\n📊 Final Statistics:");
    const allJobs = await persistence.getAllJobs();
    const stats = allJobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(stats).forEach(([status, count]) => {
      console.log(`   ${status}: ${count} jobs`);
    });

    const brokerState = broker.getState();
    console.log(`   Active workers: ${brokerState.workers.size}`);
    console.log(`   Processing jobs: ${brokerState.processingJobs.size}`);
  } catch (error) {
    console.error("❌ Demo error:", error);
  } finally {
    // Cleanup
    console.log("\n🧹 Cleaning up...");

    await client.disconnect();

    for (const worker of workers) {
      await worker.stop();
    }

    await broker.stop();

    console.log("✨ JQP Client Demo completed successfully!");
  }
}

// Additional utility class for real-world usage
export class JobQueueService {
  private client: JQPClient;

  constructor(
    brokerUrl: string,
    config?: {
      timeout?: number;
      maxRetries?: number;
      retryDelay?: number;
    }
  ) {
    this.client = new JQPClient(brokerUrl, config);
  }

  /**
   * Send email notification (fire-and-forget)
   */
  async sendEmailNotification(
    to: string,
    subject: string,
    body: string
  ): Promise<string> {
    return this.client.enqueueJob({
      job_type: "email.send",
      payload: JSON.stringify({ to, subject, body }),
    });
  }

  /**
   * Process image and return result URL
   */
  async processImage(
    imageUrl: string,
    operation: string,
    options: any
  ): Promise<string> {
    const result = await this.client.submitJobAndWait({
      job_type: "image.process",
      payload: JSON.stringify({
        url: imageUrl,
        operation,
        ...options,
      }),
    });

    const processed = JSON.parse(result);
    return processed.processedUrl;
  }

  /**
   * Submit batch of jobs and monitor progress
   */
  async processBatch<T>(
    jobType: string,
    items: T[],
    payloadMapper: (item: T) => string,
    onProgress?: (completed: number, total: number) => void
  ): Promise<string[]> {
    // Submit all jobs
    const jobIds = await Promise.all(
      items.map((item) =>
        this.client.enqueueJob({
          job_type: jobType,
          payload: payloadMapper(item),
        })
      )
    );

    // Monitor progress
    const results: string[] = [];
    let completed = 0;

    while (completed < jobIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      for (let i = 0; i < jobIds.length; i++) {
        if (results[i]) continue; // Already completed

        const status = await this.client.getJobStatus(jobIds[i]);
        if (status.status === "completed") {
          results[i] = status.result || "";
          completed++;
          onProgress?.(completed, jobIds.length);
        } else if (status.status === "failed") {
          results[i] = `ERROR: ${status.result}`;
          completed++;
          onProgress?.(completed, jobIds.length);
        }
      }
    }

    return results;
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
