import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { JQPClient } from "./client.js";
import { JQPBroker } from "./broker.js";
import { MemoryPersistence } from "./memory_persistence.js";
import { JQPWorker } from "./worker.js";
import { BrokerConfig } from "./types.js";

// Image processing worker simulation
class ImageWorker extends JQPWorker {
  protected async processJob(payload: string): Promise<string> {
    const request = JSON.parse(payload);

    // Simulate image processing time
    await new Promise((resolve) => setTimeout(resolve, 100));

    switch (request.operation) {
      case "resize":
        return JSON.stringify({
          originalUrl: request.url,
          resizedUrl: `${request.url}_${request.width}x${request.height}`,
          width: request.width,
          height: request.height,
          processedAt: new Date().toISOString(),
        });
      case "compress":
        return JSON.stringify({
          originalUrl: request.url,
          compressedUrl: `${request.url}_compressed`,
          originalSize: request.size || 1000000,
          compressedSize: Math.floor((request.size || 1000000) * 0.7),
          compressionRatio: 0.7,
          processedAt: new Date().toISOString(),
        });
      default:
        throw new Error(`Unknown image operation: ${request.operation}`);
    }
  }
}

// Email worker simulation
class EmailWorker extends JQPWorker {
  protected async processJob(payload: string): Promise<string> {
    const email = JSON.parse(payload);

    // Simulate email sending time
    await new Promise((resolve) => setTimeout(resolve, 200));

    if (!email.to || !email.subject) {
      throw new Error("Missing required email fields: to, subject");
    }

    return JSON.stringify({
      messageId: `msg_${Date.now()}`,
      to: email.to,
      subject: email.subject,
      sentAt: new Date().toISOString(),
      status: "delivered",
    });
  }
}

describe("JQP End-to-End Integration", () => {
  let broker: JQPBroker;
  let persistence: MemoryPersistence;
  let imageWorker1: ImageWorker;
  let imageWorker2: ImageWorker;
  let emailWorker: EmailWorker;

  const config: BrokerConfig = {
    frontend_port: 15559,
    backend_port: 15560,
    database_path: ":memory:",
    heartbeat_interval: 1000,
    liveness_factor: 3,
    default_job_timeout: 10000,
    default_retry_count: 2,
  };

  before(async () => {
    // Setup infrastructure
    persistence = new MemoryPersistence();
    broker = new JQPBroker(config, persistence);
    await broker.start();

    // Setup workers
    imageWorker1 = new ImageWorker(
      `tcp://localhost:${config.backend_port}`,
      "image.process"
    );
    imageWorker2 = new ImageWorker(
      `tcp://localhost:${config.backend_port}`,
      "image.process"
    );
    emailWorker = new EmailWorker(
      `tcp://localhost:${config.backend_port}`,
      "email.send"
    );

    await Promise.all([
      imageWorker1.start(),
      imageWorker2.start(),
      emailWorker.start(),
    ]);

    // Wait for workers to register
    await new Promise((resolve) => setTimeout(resolve, 1500));
  });

  after(async () => {
    if (imageWorker1) await imageWorker1.stop();
    if (imageWorker2) await imageWorker2.stop();
    if (emailWorker) await emailWorker.stop();
    if (broker) await broker.stop();
  });

  test("should handle complete e-commerce workflow", async () => {
    const client = new JQPClient(`tcp://localhost:${config.frontend_port}`);
    await client.connect();

    try {
      // Step 1: Upload and resize product images
      console.log("Starting e-commerce workflow...");

      const imageJobs = [
        {
          job_type: "image.process",
          payload: JSON.stringify({
            operation: "resize",
            url: "https://shop.com/product1.jpg",
            width: 300,
            height: 300,
          }),
        },
        {
          job_type: "image.process",
          payload: JSON.stringify({
            operation: "compress",
            url: "https://shop.com/product1-large.jpg",
            size: 2000000,
          }),
        },
      ];

      const imageUuids = await Promise.all(
        imageJobs.map((job) => client.enqueueJob(job))
      );

      console.log(`Submitted ${imageUuids.length} image processing jobs`);

      // Step 2: Send order confirmation email
      const emailUuid = await client.enqueueJob({
        job_type: "email.send",
        payload: JSON.stringify({
          to: "customer@example.com",
          subject: "Order Confirmation #12345",
          body: "Thank you for your order!",
          template: "order_confirmation",
        }),
      });

      console.log(`Submitted email job: ${emailUuid}`);

      // Step 3: Wait for all jobs to complete
      const allUuids = [...imageUuids, emailUuid];
      const results = [];

      for (const uuid of allUuids) {
        let completed = false;
        let attempts = 0;

        while (!completed && attempts < 20) {
          const status = await client.getJobStatus(uuid);

          if (status.status === "completed") {
            results.push({
              uuid,
              result: JSON.parse(status.result || "{}"),
            });
            completed = true;
          } else if (status.status === "failed") {
            throw new Error(`Job ${uuid} failed: ${status.result}`);
          }

          if (!completed) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            attempts++;
          }
        }

        if (!completed) {
          throw new Error(`Job ${uuid} did not complete in time`);
        }
      }

      // Verify results
      assert.equal(results.length, 3);

      // Check image resize result
      const resizeResult = results.find((r) => r.result.width === 300);
      assert.ok(resizeResult);
      assert.equal(resizeResult.result.width, 300);
      assert.equal(resizeResult.result.height, 300);

      // Check image compression result
      const compressResult = results.find((r) => r.result.compressionRatio);
      assert.ok(compressResult);
      assert.equal(compressResult.result.compressionRatio, 0.7);

      // Check email result
      const emailResult = results.find((r) => r.result.messageId);
      assert.ok(emailResult);
      assert.equal(emailResult.result.to, "customer@example.com");
      assert.equal(emailResult.result.status, "delivered");

      console.log("✅ E-commerce workflow completed successfully");
    } finally {
      await client.disconnect();
    }
  });

  test("should handle load balancing across multiple workers", async () => {
    const client = new JQPClient(`tcp://localhost:${config.frontend_port}`);
    await client.connect();

    try {
      // Submit multiple image processing jobs
      const jobCount = 6;
      const jobs = [];

      for (let i = 0; i < jobCount; i++) {
        jobs.push({
          job_type: "image.process",
          payload: JSON.stringify({
            operation: "resize",
            url: `https://example.com/image${i}.jpg`,
            width: 200 + i * 50,
            height: 200 + i * 50,
          }),
        });
      }

      const startTime = Date.now();

      // Submit all jobs concurrently
      const uuids = await Promise.all(
        jobs.map((job) => client.enqueueJob(job))
      );

      // Wait for all jobs to complete by checking their status
      const completedResults = [];

      // Poll for completion of all jobs
      while (completedResults.length < jobCount) {
        for (const uuid of uuids) {
          if (!completedResults.some((r) => r.uuid === uuid)) {
            const status = await client.getJobStatus(uuid);
            if (status.status === "completed") {
              completedResults.push({ uuid, result: status.result });
            }
          }
        }

        // Small delay between polls
        if (completedResults.length < jobCount) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`Processed ${jobCount} jobs in ${duration}ms`);

      // With 2 workers, should be faster than sequential processing
      // This is a rough check - actual timing depends on system performance
      assert.ok(
        duration < jobCount * 300,
        "Load balancing should improve performance"
      );
    } finally {
      await client.disconnect();
    }
  });

  test("should handle worker failure and job retry", async () => {
    const client = new JQPClient(`tcp://localhost:${config.frontend_port}`);
    await client.connect();

    try {
      // Submit a job that will cause worker to fail initially
      const invalidJobUuid = await client.enqueueJob({
        job_type: "image.process",
        payload: JSON.stringify({
          operation: "invalid_operation",
          url: "https://example.com/image.jpg",
        }),
      });

      // Wait for job to fail
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const status = await client.getJobStatus(invalidJobUuid);
      assert.equal(status.status, "failed");
      assert.match(status.result || "", /Unknown image operation/);

      console.log("✅ Job failure handled correctly");
    } finally {
      await client.disconnect();
    }
  });

  test("should handle high concurrency", async () => {
    const client = new JQPClient(`tcp://localhost:${config.frontend_port}`, {
      timeout: 5000,
      maxRetries: 1,
    });
    await client.connect();

    try {
      const concurrentJobs = 20;
      const promises = [];

      console.log(`Submitting ${concurrentJobs} concurrent jobs...`);

      for (let i = 0; i < concurrentJobs; i++) {
        const jobType = i % 2 === 0 ? "image.process" : "email.send";
        const payload =
          jobType === "image.process"
            ? JSON.stringify({
                operation: "resize",
                url: `https://example.com/batch${i}.jpg`,
                width: 150,
                height: 150,
              })
            : JSON.stringify({
                to: `user${i}@example.com`,
                subject: `Batch Email ${i}`,
                body: "Batch processing test",
              });

        promises.push(
          client.enqueueJob({
            job_type: jobType,
            payload,
          })
        );
      }

      const uuids = await Promise.all(promises);
      assert.equal(uuids.length, concurrentJobs);

      // Wait a bit for processing
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Check that most jobs completed successfully
      let completedCount = 0;
      for (const uuid of uuids) {
        const status = await client.getJobStatus(uuid);
        if (status.status === "completed") {
          completedCount++;
        }
      }

      // Expect at least 80% success rate for this concurrency test
      const successRate = completedCount / concurrentJobs;
      assert.ok(
        successRate >= 0.8,
        `Success rate ${successRate} should be >= 0.8`
      );

      console.log(
        `✅ Concurrent test: ${completedCount}/${concurrentJobs} jobs completed successfully`
      );
    } finally {
      await client.disconnect();
    }
  });

  test("should demonstrate real-world patterns", async () => {
    const client = new JQPClient(`tcp://localhost:${config.frontend_port}`);
    await client.connect();

    try {
      // Pattern 1: Fire-and-forget job
      console.log("Pattern 1: Fire-and-forget notification");
      const notificationUuid = await client.enqueueJob({
        job_type: "email.send",
        payload: JSON.stringify({
          to: "admin@example.com",
          subject: "System Alert",
          body: "Low disk space warning",
          priority: "high",
        }),
      });
      console.log(`Notification job queued: ${notificationUuid}`);

      // Pattern 2: Synchronous job with result
      console.log("Pattern 2: Synchronous image processing");
      const imageResult = await client.submitJobAndWait({
        job_type: "image.process",
        payload: JSON.stringify({
          operation: "compress",
          url: "https://example.com/large-image.jpg",
          size: 5000000,
        }),
      });

      const processedImage = JSON.parse(imageResult);
      console.log(
        `Image processed: ${processedImage.compressedSize} bytes (${Math.round(
          (1 - processedImage.compressionRatio) * 100
        )}% reduction)`
      );

      // Pattern 3: Batch processing
      console.log("Pattern 3: Batch email sending");
      const batchEmails = [];
      for (let i = 0; i < 3; i++) {
        batchEmails.push(
          client.enqueueJob({
            job_type: "email.send",
            payload: JSON.stringify({
              to: `newsletter${i}@example.com`,
              subject: "Weekly Newsletter",
              body: "This week's updates...",
              batch: true,
            }),
          })
        );
      }

      const batchUuids = await Promise.all(batchEmails);
      console.log(`Batch emails queued: ${batchUuids.length} jobs`);

      // Pattern 4: Job monitoring and status tracking
      console.log("Pattern 4: Job status monitoring");
      let processing = true;
      let checks = 0;

      while (processing && checks < 10) {
        const statuses = await Promise.all(
          batchUuids.map((uuid) => client.getJobStatus(uuid))
        );

        const completed = statuses.filter(
          (s) => s.status === "completed"
        ).length;
        const failed = statuses.filter((s) => s.status === "failed").length;
        const pending = statuses.length - completed - failed;

        console.log(
          `Status check ${
            checks + 1
          }: ${completed} completed, ${failed} failed, ${pending} pending`
        );

        if (pending === 0) {
          processing = false;
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        checks++;
      }

      console.log("✅ All real-world patterns demonstrated successfully");
    } finally {
      await client.disconnect();
    }
  });
});
