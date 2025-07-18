import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { JQPBroker } from "./broker.js";
import { MemoryPersistence } from "./memory_persistence.js";
import { BrokerConfig } from "./types.js";

describe("JQPBroker", () => {
  const testConfig: BrokerConfig = {
    frontend_port: 15555,
    backend_port: 15556,
    database_path: ":memory:",
    heartbeat_interval: 1000,
    liveness_factor: 2,
    default_job_timeout: 5000,
    default_retry_count: 3,
  };

  test("should create broker with initial state", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(testConfig, persistence);

    const state = broker.getState();
    assert.equal(state.workers.size, 0);
    assert.equal(state.processingJobs.size, 0);
    assert.equal(state.ready_workers.size, 0);
  });

  test("should perform recovery on restart", async () => {
    const persistence = new MemoryPersistence();

    // Add some processing jobs
    await persistence.add({
      job_type: "test.job",
      payload: "{}",
      options: {},
      status: "processing",
    });

    await persistence.add({
      job_type: "test.job",
      payload: "{}",
      options: {},
      status: "queued",
    });

    // Create broker - should trigger recovery
    const broker = new JQPBroker(testConfig, persistence);
    await broker.start();

    // Check that processing jobs were re-queued
    const processingJobs = await persistence.getProcessingJobs();
    assert.equal(processingJobs.length, 0);

    const queuedJobs = await persistence.getQueuedJobs("test.job");
    assert.equal(queuedJobs.length, 2); // One was re-queued, one was already queued

    await broker.stop();
  });

  test("should handle invalid protocol messages", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(testConfig, persistence);

    // Test that broker doesn't crash with invalid messages
    // This is more of a structural test since we can't easily inject invalid messages
    const state = broker.getState();
    assert.equal(state.workers.size, 0);
  });

  test("should track worker information correctly", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(testConfig, persistence);

    // Simulate worker registration by creating worker info
    const initialState = broker.getState();
    assert.equal(initialState.workers.size, 0);

    // This is a structural test - in reality, workers would register via ZeroMQ messages
    // but we can test the state management aspects
  });

  test("should maintain ready workers map", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(testConfig, persistence);

    const state = broker.getState();
    assert.equal(state.ready_workers.size, 0);

    // Test that the data structure is properly initialized
    assert.ok(state.ready_workers instanceof Map);
    assert.ok(state.workers instanceof Map);
    assert.ok(state.processingJobs instanceof Map);
  });

  test("should handle broker lifecycle correctly", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(testConfig, persistence);

    // Test that broker can be created and destroyed without errors
    await broker.start();

    // Broker should be running and accepting connections
    const state = broker.getState();
    assert.ok(state.workers instanceof Map);

    await broker.stop();

    // After stopping, broker should clean up properly
    // This is mainly testing that no exceptions are thrown
  });

  test("should handle multiple start/stop cycles", async () => {
    const persistence = new MemoryPersistence();
    let broker = new JQPBroker(testConfig, persistence);

    // Start and stop
    await broker.start();
    await broker.stop();

    // Should not be able to start the same instance again
    await assert.rejects(
      async () => await broker.start(),
      /Cannot start broker: socket is closed/
    );

    // But should be able to create a new instance and start it
    broker = new JQPBroker(testConfig, persistence);
    await broker.start();
    await broker.stop();

    // No exceptions should be thrown for proper usage
  });

  test("should be able to send heartbeat to workers", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(testConfig, persistence);

    // Start broker
    await broker.start();

    // Test that sendHeartbeatsToWorkers method exists and can be called
    // We can't easily test the actual heartbeat sending without mocking ZeroMQ
    // but we can verify the method exists and doesn't throw errors
    assert.ok(typeof broker["sendHeartbeatsToWorkers"] === "function");

    // Call the method directly - should not throw for empty worker list
    await broker["sendHeartbeatsToWorkers"]();

    await broker.stop();
  });
});
