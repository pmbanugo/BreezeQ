import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { MemoryPersistence } from "./memory_persistence.js";
import { JobStatus } from "./types.js";

describe("MemoryPersistence", () => {
  test("should add and retrieve jobs", async () => {
    const persistence = new MemoryPersistence();
    
    const jobData = {
      job_type: "test.job",
      payload: '{"test": "data"}',
      options: { retries: 3, priority: 1 },
      status: "queued" as JobStatus,
    };
    
    const jobId = await persistence.add(jobData);
    assert.ok(jobId);
    assert.ok(typeof jobId === "string");
    
    const retrievedJob = await persistence.get(jobId);
    assert.ok(retrievedJob);
    assert.equal(retrievedJob.job_type, "test.job");
    assert.equal(retrievedJob.payload, '{"test": "data"}');
    assert.equal(retrievedJob.status, "queued");
    assert.equal(retrievedJob.retries_left, 3);
    assert.ok(retrievedJob.created_at instanceof Date);
    assert.ok(retrievedJob.updated_at instanceof Date);
  });
  
  test("should return null for non-existent job", async () => {
    const persistence = new MemoryPersistence();
    
    const job = await persistence.get("non-existent-id");
    assert.equal(job, null);
  });
  
  test("should update existing job", async () => {
    const persistence = new MemoryPersistence();
    
    const jobData = {
      job_type: "test.job",
      payload: '{"test": "data"}',
      options: { retries: 3 },
      status: "queued" as JobStatus,
    };
    
    const jobId = await persistence.add(jobData);
    
    // Add a small delay to ensure updated_at is different
    await new Promise(resolve => setTimeout(resolve, 1));
    
    await persistence.update(jobId, {
      status: "processing",
      result: "processing started",
    });
    
    const updatedJob = await persistence.get(jobId);
    assert.ok(updatedJob);
    assert.equal(updatedJob.status, "processing");
    assert.equal(updatedJob.result, "processing started");
    assert.ok(updatedJob.updated_at >= updatedJob.created_at);
  });
  
  test("should throw error when updating non-existent job", async () => {
    const persistence = new MemoryPersistence();
    
    await assert.rejects(
      async () => await persistence.update("non-existent-id", { status: "completed" }),
      /Job non-existent-id not found/
    );
  });
  
  test("should get queued jobs by job type", async () => {
    const persistence = new MemoryPersistence();
    
    // Add jobs of different types and statuses
    await persistence.add({
      job_type: "image.resize",
      payload: "{}",
      options: { priority: 2 },
      status: "queued",
    });
    
    await persistence.add({
      job_type: "image.resize",
      payload: "{}",
      options: { priority: 1 },
      status: "queued",
    });
    
    await persistence.add({
      job_type: "image.resize",
      payload: "{}",
      options: {},
      status: "processing",
    });
    
    await persistence.add({
      job_type: "email.send",
      payload: "{}",
      options: {},
      status: "queued",
    });
    
    const imageJobs = await persistence.getQueuedJobs("image.resize");
    assert.equal(imageJobs.length, 2);
    assert.equal(imageJobs[0].options.priority, 1); // Should be sorted by priority
    assert.equal(imageJobs[1].options.priority, 2);
    
    const emailJobs = await persistence.getQueuedJobs("email.send");
    assert.equal(emailJobs.length, 1);
  });
  
  test("should get processing jobs", async () => {
    const persistence = new MemoryPersistence();
    
    // Add jobs with different statuses
    await persistence.add({
      job_type: "test.job",
      payload: "{}",
      options: {},
      status: "queued",
    });
    
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
      status: "completed",
    });
    
    const processingJobs = await persistence.getProcessingJobs();
    assert.equal(processingJobs.length, 1);
    assert.equal(processingJobs[0].status, "processing");
  });
  
  test("should get jobs by status", async () => {
    const persistence = new MemoryPersistence();
    
    await persistence.add({
      job_type: "test.job",
      payload: "{}",
      options: {},
      status: "queued",
    });
    
    await persistence.add({
      job_type: "test.job",
      payload: "{}",
      options: {},
      status: "failed",
    });
    
    const failedJobs = await persistence.getJobsByStatus("failed");
    assert.equal(failedJobs.length, 1);
    assert.equal(failedJobs[0].status, "failed");
  });
  
  test("should clear all jobs", async () => {
    const persistence = new MemoryPersistence();
    
    await persistence.add({
      job_type: "test.job",
      payload: "{}",
      options: {},
      status: "queued",
    });
    
    assert.equal(persistence.getJobCount(), 1);
    
    await persistence.clear();
    assert.equal(persistence.getJobCount(), 0);
    
    const allJobs = await persistence.getAllJobs();
    assert.equal(allJobs.length, 0);
  });
  
  test("should generate unique job IDs", async () => {
    const persistence = new MemoryPersistence();
    
    const jobData = {
      job_type: "test.job",
      payload: "{}",
      options: {},
      status: "queued" as JobStatus,
    };
    
    const id1 = await persistence.add(jobData);
    const id2 = await persistence.add(jobData);
    
    assert.notEqual(id1, id2);
  });
});
