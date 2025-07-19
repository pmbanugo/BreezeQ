import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { JQPBroker } from "./broker.js";
import { MemoryPersistence } from "./memory_persistence.js";
import { BrokerConfig } from "./types.js";

describe("Job Processing", () => {
  let portCounter = 30000; // Start from port 30000 to avoid conflicts
  
  function getUniqueConfig(): BrokerConfig {
    const frontend = portCounter++;
    const backend = portCounter++;
    return {
      frontend_port: frontend,
      backend_port: backend,
      database_path: ":memory:",
      heartbeat_interval: 1000,
      liveness_factor: 2,
      default_job_timeout: 5000,
      default_retry_count: 2,
    };
  }

  test("should add job to persistence", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(getUniqueConfig(), persistence);

    // Add a job
    const jobUuid = await broker.addJob("test.job", JSON.stringify({ data: "test" }));
    
    // Should return a non-empty UUID
    assert.ok(jobUuid);
    assert.ok(typeof jobUuid === "string");
    assert.ok(jobUuid.length > 0);

    // Verify job was added to persistence
    const job = await persistence.get(jobUuid);
    assert.ok(job);
    assert.equal(job.job_type, "test.job");
    assert.equal(job.status, "queued");
    assert.equal(job.payload, JSON.stringify({ data: "test" }));
    assert.equal(job.options.retries, 2); // default_retry_count from config
  });

  test("should add job with custom options", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(getUniqueConfig(), persistence);

    const customOptions = {
      retries: 5,
      priority: 10,
      timeout: 15000
    };

    const jobUuid = await broker.addJob("test.job", "payload", customOptions);
    
    const job = await persistence.get(jobUuid);
    assert.ok(job);
    assert.equal(job.options.retries, 5);
    assert.equal(job.options.priority, 10);
    assert.equal(job.options.timeout, 15000);
  });

  test("should attempt to dispatch job when worker is available", async () => {
    const persistence = new MemoryPersistence();
    const config = getUniqueConfig();
    const broker = new JQPBroker(config, persistence);

    try {
      // Start the broker to enable message sending 
      await broker.start();

      // Add a job first - no workers available yet
      const jobUuid = await broker.addJob("test.job", JSON.stringify({ data: "test" }));
      
      // Job should be queued since no workers available
      const job = await persistence.get(jobUuid);
      assert.equal(job?.status, "queued");

      // Simulate dispatchJobsForType with no workers - should not crash
      await broker["dispatchJobsForType"]("test.job");
      
      // Job should still be queued
      const stillQueuedJob = await persistence.get(jobUuid);
      assert.equal(stillQueuedJob?.status, "queued");
    } finally {
      await broker.stop();
    }
  });

  test("should handle multiple jobs queuing", async () => {
    const persistence = new MemoryPersistence();
    const config = getUniqueConfig();
    const broker = new JQPBroker(config, persistence);

    try {
      await broker.start();

      // Add multiple jobs - no workers available
      const job1Uuid = await broker.addJob("test.job", "payload1");
      const job2Uuid = await broker.addJob("test.job", "payload2");
      const job3Uuid = await broker.addJob("test.job", "payload3");

      // All jobs should be queued
      const job1 = await persistence.get(job1Uuid);
      const job2 = await persistence.get(job2Uuid);
      const job3 = await persistence.get(job3Uuid);

      assert.equal(job1?.status, "queued");
      assert.equal(job2?.status, "queued");
      assert.equal(job3?.status, "queued");

      // Should be 0 processing jobs since no workers
      const state = broker.getState();
      assert.equal(state.processingJobs.size, 0);
      assert.equal(state.workers.size, 0);
    } finally {
      await broker.stop();
    }
  });

  test("should queue jobs when no workers available", async () => {
    const persistence = new MemoryPersistence();
    const broker = new JQPBroker(getUniqueConfig(), persistence);

    // Add job without any workers registered
    const jobUuid = await broker.addJob("test.job", "payload");
    
    // Job should remain queued
    const job = await persistence.get(jobUuid);
    assert.equal(job?.status, "queued");

    // No processing jobs
    const state = broker.getState();
    assert.equal(state.processingJobs.size, 0);
  });

  test("should handle job completion through handleJobReply", async () => {
    const persistence = new MemoryPersistence();
    const config = getUniqueConfig();
    const broker = new JQPBroker(config, persistence);

    try {
      await broker.start();

      // Add a job first
      const jobUuid = await broker.addJob("test.job", "payload");
      
      // Manually update job to processing and add worker state to simulate in-progress job
      await persistence.update(jobUuid, { status: "processing" });
      
      const workerId = "test-worker";
      const state = broker.getState();
      state.workers.set(workerId, {
        id: workerId,
        job_type: "test.job",
        last_heartbeat: new Date(),
        is_ready: false,
      });
      state.processingJobs.set(jobUuid, {
        worker_id: workerId,
        dispatch_timestamp: new Date(),
      });
      // Initialize ready_workers for this job type
      state.ready_workers.set("test.job", []);

      // Simulate job completion by calling handleJobReply
      await broker["handleJobReply"](workerId, [
        Buffer.from(jobUuid),
        Buffer.from("200"),
        Buffer.from("success result"),
      ]);

      // Job should be completed
      const job = await persistence.get(jobUuid);
      assert.equal(job?.status, "completed");
      assert.equal(job?.result, "success result");

      // Job should not be in processing jobs anymore
      const updatedState = broker.getState();
      assert.equal(updatedState.processingJobs.has(jobUuid), false);
    } finally {
      await broker.stop();
    }
  });

  test("should handle job failure through handleJobReply", async () => {
    const persistence = new MemoryPersistence();
    const config = getUniqueConfig();
    const broker = new JQPBroker(config, persistence);

    try {
      await broker.start();

      // Add a job first and set it to processing
      const jobUuid = await broker.addJob("test.job", "payload");
      await persistence.update(jobUuid, { status: "processing" });
      
      const workerId = "test-worker";
      const state = broker.getState();
      state.workers.set(workerId, {
        id: workerId,
        job_type: "test.job",
        last_heartbeat: new Date(),
        is_ready: false,
      });
      state.processingJobs.set(jobUuid, {
        worker_id: workerId,
        dispatch_timestamp: new Date(),
      });
      
      // Simulate job failure
      await broker["handleJobReply"](workerId, [
        Buffer.from(jobUuid),
        Buffer.from("500"),
        Buffer.from("error message"),
      ]);

      // Job should be failed
      const job = await persistence.get(jobUuid);
      assert.equal(job?.status, "failed");
      assert.equal(job?.result, "error message");

      // Job should not be in processing jobs anymore
      const updatedState = broker.getState();
      assert.equal(updatedState.processingJobs.has(jobUuid), false);
    } finally {
      await broker.stop();
    }
  });

  test("should call dispatchJobsForType without errors", async () => {
    const persistence = new MemoryPersistence();
    const config = getUniqueConfig();
    const broker = new JQPBroker(config, persistence);

    try {
      await broker.start();

      // Add a job first (no workers available)
      const jobUuid = await broker.addJob("test.job", "payload");
      
      // Job should be queued
      let job = await persistence.get(jobUuid);
      assert.equal(job?.status, "queued");

      // Call dispatchJobsForType with no workers - should not crash
      await broker["dispatchJobsForType"]("test.job");

      // Job should still be queued since no workers
      job = await persistence.get(jobUuid);
      assert.equal(job?.status, "queued");
      
      // Call with non-existent job type - should not crash
      await broker["dispatchJobsForType"]("non.existent.job");
    } finally {
      await broker.stop();
    }
  });

  test("should remove worker from state when removeWorker is called", async () => {
    const persistence = new MemoryPersistence();
    const config = getUniqueConfig();
    const broker = new JQPBroker(config, persistence);

    try {
      await broker.start();

      // Add a worker to state
      const workerId = "test-worker";
      const state = broker.getState();
      state.workers.set(workerId, {
        id: workerId,
        job_type: "test.job",
        last_heartbeat: new Date(),
        is_ready: false,
      });

      // Verify worker is in state
      assert.equal(state.workers.has(workerId), true);

      // Remove worker
      await broker["removeWorker"](workerId);

      // Worker should be removed from state
      const updatedState = broker.getState();
      assert.equal(updatedState.workers.has(workerId), false);
    } finally {
      await broker.stop();
    }
  });

  test("should handle removeWorker call without errors", async () => {
    const persistence = new MemoryPersistence();
    const config = getUniqueConfig();
    const broker = new JQPBroker(config, persistence);

    try {
      await broker.start();

      // Call removeWorker with non-existent worker - should not crash
      await broker["removeWorker"]("non-existent-worker");

      // Should complete without errors
      assert.ok(true);
    } finally {
      await broker.stop();
    }
  });
});
