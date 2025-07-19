import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { JQPBroker } from "./broker.js";
import { JQPWorker } from "./worker.js";
import { MemoryPersistence } from "./memory_persistence.js";
import { BrokerConfig } from "./types.js";

describe("Heartbeat Integration Tests", () => {
  const testConfig: BrokerConfig = {
    frontend_port: 25555,
    backend_port: 25556,
    database_path: ":memory:",
    heartbeat_interval: 1000, // 1 second for faster tests
    liveness_factor: 2, // 2 seconds before considering peer dead
    default_job_timeout: 5000,
    default_retry_count: 3,
  };

  test("should maintain stable connection with heartbeats", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(testConfig, persistence);

    await broker.start();

    // Create a worker
    const worker = new JQPWorker(
      `tcp://localhost:${testConfig.backend_port}`,
      "test.job",
      {
        heartbeatInterval: testConfig.heartbeat_interval,
        livenessFactor: testConfig.liveness_factor,
      }
    );

    await worker.start();

    // Wait for initial connection
    await sleep(100);

    // Check that worker is registered
    let state = broker.getState();
    assert.equal(state.workers.size, 1);

    // Wait for several heartbeat cycles
    await sleep(testConfig.heartbeat_interval * 3);

    // Worker should still be connected
    state = broker.getState();
    assert.equal(state.workers.size, 1);

    // Check that heartbeat times are recent
    const [workerId, workerInfo] = Array.from(state.workers.entries())[0];
    const timeSinceHeartbeat = Date.now() - workerInfo.last_heartbeat.getTime();
    assert.ok(timeSinceHeartbeat < testConfig.heartbeat_interval * 2);

    await worker.stop();
    await broker.stop();
  });

  test("should detect worker failure after missed heartbeats", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(testConfig, persistence);

    await broker.start();

    // Create a worker
    const worker = new JQPWorker(
      `tcp://localhost:${testConfig.backend_port}`,
      "test.job",
      {
        heartbeatInterval: testConfig.heartbeat_interval,
        livenessFactor: testConfig.liveness_factor,
      }
    );

    await worker.start();

    // Wait for initial connection
    await sleep(100);

    // Verify worker is registered
    let state = broker.getState();
    assert.equal(state.workers.size, 1);

    // Stop worker abruptly (simulating crash)
    await worker.stop();

    // Wait for broker to detect failure
    await sleep(
      testConfig.heartbeat_interval * testConfig.liveness_factor + 500
    );

    // Worker should be removed
    state = broker.getState();
    assert.equal(state.workers.size, 0);

    await broker.stop();
  });

  test("should handle worker reconnection", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(testConfig, persistence);

    await broker.start();

    // Create initial worker
    let worker = new JQPWorker(
      `tcp://localhost:${testConfig.backend_port}`,
      "test.job",
      {
        heartbeatInterval: testConfig.heartbeat_interval,
        livenessFactor: testConfig.liveness_factor,
      }
    );

    await worker.start();
    await sleep(100);

    // Get initial worker ID
    let state = broker.getState();
    assert.equal(state.workers.size, 1);
    const initialWorkerId = Array.from(state.workers.keys())[0];

    // Stop worker
    await worker.stop();

    // Wait for broker to detect failure
    await sleep(
      testConfig.heartbeat_interval * testConfig.liveness_factor + 500
    );

    // Verify worker is removed
    state = broker.getState();
    assert.equal(state.workers.size, 0);

    // Reconnect with new worker instance
    worker = new JQPWorker(
      `tcp://localhost:${testConfig.backend_port}`,
      "test.job",
      {
        heartbeatInterval: testConfig.heartbeat_interval,
        livenessFactor: testConfig.liveness_factor,
      }
    );

    await worker.start();
    await sleep(100);

    // Should have new worker registered
    state = broker.getState();
    assert.equal(state.workers.size, 1);

    const newWorkerId = Array.from(state.workers.keys())[0];
    assert.notEqual(initialWorkerId, newWorkerId); // Should be different worker ID

    await worker.stop();
    await broker.stop();
  });

  test("should handle multiple workers with heartbeats", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(testConfig, persistence);

    await broker.start();

    // Create multiple workers
    const workers = [];
    for (let i = 0; i < 3; i++) {
      const worker = new JQPWorker(
        `tcp://localhost:${testConfig.backend_port}`,
        `job.type${i}`,
        {
          heartbeatInterval: testConfig.heartbeat_interval,
          livenessFactor: testConfig.liveness_factor,
        }
      );
      workers.push(worker);
      await worker.start();
      await sleep(50); // Small delay between starts
    }

    // Wait for all connections
    await sleep(200);

    // All workers should be registered
    let state = broker.getState();
    assert.equal(state.workers.size, 3);
    assert.equal(state.ready_workers.size, 3);

    // Wait for heartbeat cycles
    await sleep(testConfig.heartbeat_interval * 2);

    // All workers should still be connected
    state = broker.getState();
    assert.equal(state.workers.size, 3);

    // Stop one worker
    await workers[1].stop();

    // Wait for broker to detect failure
    await sleep(
      testConfig.heartbeat_interval * testConfig.liveness_factor + 500
    );

    // Should have 2 workers remaining
    state = broker.getState();
    assert.equal(state.workers.size, 2);

    // Clean up
    await workers[0].stop();
    await workers[2].stop();
    await broker.stop();
  });
});

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
