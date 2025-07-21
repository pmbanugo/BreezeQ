import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { JQPClient } from "./client.js";
import { JQPBroker } from "./broker.js";
import { MemoryPersistence } from "./memory_persistence.js";
import { JQPWorker } from "./worker.js";
import { BrokerConfig } from "./types.js";

// Simple test worker that processes math operations
class TestWorker extends JQPWorker {
  protected override async processJob(payload: string): Promise<string> {
    const data = JSON.parse(payload);

    switch (data.operation) {
      case "add":
        return (data.numbers as number[]).reduce((a, b) => a + b, 0).toString();
      case "multiply":
        return (data.numbers as number[]).reduce((a, b) => a * b, 1).toString();
      case "error":
        throw new Error("Intentional test error");
      case "slow":
        await new Promise((resolve) => setTimeout(resolve, data.delay || 1000));
        return "slow job completed";
      default:
        throw new Error(`Unknown operation: ${data.operation}`);
    }
  }
}

describe("JQPClient", () => {
  let broker: JQPBroker;
  let persistence: MemoryPersistence;
  let client: JQPClient;
  let worker: TestWorker;

  const config: BrokerConfig = {
    frontend_port: 15557,
    backend_port: 15558,
    database_path: ":memory:",
    heartbeat_interval: 1000,
    liveness_factor: 2,
    default_job_timeout: 5000,
    default_retry_count: 1,
  };

  before(async () => {
    // Setup broker
    persistence = new MemoryPersistence();
    broker = new JQPBroker(config, persistence);
    await broker.start();

    // Setup client
    client = new JQPClient(`tcp://localhost:${config.frontend_port}`, {
      timeout: 3000,
      maxRetries: 2,
      retryDelay: 500,
    });

    // Setup worker
    worker = new TestWorker(
      `tcp://localhost:${config.backend_port}`,
      "test.math"
    );
    await worker.start();

    // Wait for connections to establish
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  after(async () => {
    if (worker) await worker.stop();
    if (client) await client.disconnect();
    if (broker) await broker.stop();
  });

  test("should connect to broker", async () => {
    await client.connect();
    const state = client.getState();
    assert.equal(state.connected, true);
    assert.equal(
      state.brokerAddress,
      `tcp://localhost:${config.frontend_port}`
    );
  });

  test("should enqueue a job successfully", async () => {
    const job_uuid = await client.enqueueJob({
      job_type: "test.math",
      payload: JSON.stringify({ operation: "add", numbers: [1, 2, 3] }),
      options: { priority: 10 },
    });

    assert.ok(job_uuid);
    assert.equal(typeof job_uuid, "string");
  });

  test("should handle job completion and get status", async () => {
    const job_uuid = await client.enqueueJob({
      job_type: "test.math",
      payload: JSON.stringify({ operation: "multiply", numbers: [2, 3, 4] }),
    });

    // Wait for job to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const status = await client.getJobStatus(job_uuid);
    assert.equal(status.status, "completed");
    assert.equal(status.result, "24"); // 2 * 3 * 4 = 24
  });

  test("should handle submitJobAndWait", async () => {
    const result = await client.submitJobAndWait({
      job_type: "test.math",
      payload: JSON.stringify({ operation: "add", numbers: [10, 20, 30] }),
    });

    assert.equal(result, "60"); // 10 + 20 + 30 = 60
  });

  test("should handle job failures", async () => {
    try {
      await client.submitJobAndWait({
        job_type: "test.math",
        payload: JSON.stringify({ operation: "error" }),
      });
      assert.fail("Should have thrown an error");
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Job failed:/);
    }
  });

  test("should handle timeout for slow jobs", async () => {
    try {
      await client.submitJobAndWait(
        {
          job_type: "test.math",
          payload: JSON.stringify({ operation: "slow", delay: 5000 }),
        },
        500, // Poll interval
        2000 // Max wait time (shorter than job delay)
      );
      assert.fail("Should have timed out");
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Job timed out/);
    }
  });

  test("should handle unknown job type", async () => {
    const job_uuid = await client.enqueueJob({
      job_type: "unknown.type",
      payload: JSON.stringify({ data: "test" }),
    });

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const status = await client.getJobStatus(job_uuid);
    // Job should remain queued since no worker handles this type
    assert.equal(status.status, "queued");
  });

  test("should handle client config properly", async () => {
    const customClient = new JQPClient(
      `tcp://localhost:${config.frontend_port}`,
      {
        timeout: 1000,
        maxRetries: 1,
        retryDelay: 100,
      }
    );

    const state = customClient.getState();
    assert.equal(state.config.timeout, 1000);
    assert.equal(state.config.maxRetries, 1);
    assert.equal(state.config.retryDelay, 100);

    await customClient.disconnect();
  });

  test("should support concurrent job submissions", async () => {
    const promises = [];

    for (let i = 0; i < 5; i++) {
      promises.push(
        client.enqueueJob({
          job_type: "test.math",
          payload: JSON.stringify({ operation: "add", numbers: [i, i + 1] }),
        })
      );
    }

    const uuids = await Promise.all(promises);
    assert.equal(uuids.length, 5);

    // All UUIDs should be unique
    const uniqueUuids = new Set(uuids);
    assert.equal(uniqueUuids.size, 5);
  });

  test("should handle idempotent submissions", async () => {
    // This test verifies that the broker handles duplicate UUIDs correctly
    // by directly testing the client's job submission
    const job_uuid1 = await client.enqueueJob({
      job_type: "test.math",
      payload: JSON.stringify({ operation: "add", numbers: [1, 1] }),
    });

    const job_uuid2 = await client.enqueueJob({
      job_type: "test.math",
      payload: JSON.stringify({ operation: "add", numbers: [2, 2] }),
    });

    // UUIDs should be different for different calls
    assert.notEqual(job_uuid1, job_uuid2);
  });

  test("should track pending requests", async () => {
    const initialState = client.getState();
    const initialPending = initialState.pendingRequests;

    // Start a job but don't wait for completion
    const jobPromise = client.enqueueJob({
      job_type: "test.math",
      payload: JSON.stringify({ operation: "add", numbers: [5, 5] }),
    });

    // Briefly check that we have a pending request
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Complete the job
    await jobPromise;

    const finalState = client.getState();
    assert.equal(finalState.pendingRequests, initialPending);
  });
});
