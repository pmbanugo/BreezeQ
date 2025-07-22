import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { RedisPersistence } from "./redis_persistence.js";
import { Job } from "./types.js";

describe("RedisPersistence", () => {
  let persistence: RedisPersistence;

  beforeEach(async () => {
    persistence = new RedisPersistence("redis://localhost:6379");
    await persistence.connect();
    await persistence.clear();
  });

  afterEach(async () => {
    await persistence.disconnect();
  });

  test("should add and get a job", async () => {
    const job: Omit<Job, "created_at" | "updated_at"> = {
      uuid: "test-uuid",
      job_type: "test-job",
      payload: "test-payload",
      options: {},
      status: "queued",
    };

    const uuid = await persistence.add(job);
    assert.strictEqual(uuid, "test-uuid");

    const retrievedJob = await persistence.get(uuid);
    assert.ok(retrievedJob);
    assert.strictEqual(retrievedJob.uuid, "test-uuid");
    assert.strictEqual(retrievedJob.job_type, "test-job");
  });

  test("should update a job", async () => {
    const job: Omit<Job, "created_at" | "updated_at"> = {
      uuid: "test-uuid",
      job_type: "test-job",
      payload: "test-payload",
      options: {},
      status: "queued",
    };

    const uuid = await persistence.add(job);
    await persistence.update(uuid, { status: "processing" });

    const retrievedJob = await persistence.get(uuid);
    assert.ok(retrievedJob);
    assert.strictEqual(retrievedJob.status, "processing");
  });

  test("should get queued jobs", async () => {
    const job1: Omit<Job, "created_at" | "updated_at"> = {
      uuid: "test-uuid-1",
      job_type: "test-job",
      payload: "test-payload",
      options: { priority: 1 },
      status: "queued",
    };
    const job2: Omit<Job, "created_at" | "updated_at"> = {
      uuid: "test-uuid-2",
      job_type: "test-job",
      payload: "test-payload",
      options: { priority: 2 },
      status: "queued",
    };

    await persistence.add(job1);
    await persistence.add(job2);

    const queuedJobs = await persistence.getQueuedJobs("test-job");
    assert.strictEqual(queuedJobs.length, 2);
    assert.strictEqual(queuedJobs[0].uuid, "test-uuid-1");
    assert.strictEqual(queuedJobs[1].uuid, "test-uuid-2");
  });

  test("should get processing jobs", async () => {
    const job1: Omit<Job, "created_at" | "updated_at"> = {
        uuid: "test-uuid-1",
        job_type: "test-job",
        payload: "test-payload",
        options: {},
        status: "processing",
    };
    await persistence.add(job1);
    await persistence.update(job1.uuid, { status: "processing" });

    const processingJobs = await persistence.getProcessingJobs();
    assert.strictEqual(processingJobs.length, 1);
    assert.strictEqual(processingJobs[0].uuid, "test-uuid-1");
    });

  test("should update many jobs", async () => {
    const job1: Omit<Job, "created_at" | "updated_at"> = {
      uuid: "test-uuid-1",
      job_type: "test-job",
      payload: "test-payload",
      options: {},
      status: "queued",
    };
    const job2: Omit<Job, "created_at" | "updated_at"> = {
      uuid: "test-uuid-2",
      job_type: "test-job",
      payload: "test-payload",
      options: {},
      status: "queued",
    };

    await persistence.add(job1);
    await persistence.add(job2);

    const result = await persistence.updateMany([
      { uuid: "test-uuid-1", data: { status: "completed" } },
      { uuid: "test-uuid-2", data: { status: "failed" } },
    ]);

    assert.strictEqual(result.successful, 2);
    assert.strictEqual(result.failed, 0);

    const retrievedJob1 = await persistence.get("test-uuid-1");
    assert.ok(retrievedJob1);
    assert.strictEqual(retrievedJob1.status, "completed");

    const retrievedJob2 = await persistence.get("test-uuid-2");
    assert.ok(retrievedJob2);
    assert.strictEqual(retrievedJob2.status, "failed");
  });

  test("should delete many jobs", async () => {
    const job1: Omit<Job, "created_at" | "updated_at"> = {
      uuid: "test-uuid-1",
      job_type: "test-job",
      payload: "test-payload",
      options: {},
      status: "queued",
    };
    const job2: Omit<Job, "created_at" | "updated_at"> = {
      uuid: "test-uuid-2",
      job_type: "test-job",
      payload: "test-payload",
      options: {},
      status: "queued",
    };

    await persistence.add(job1);
    await persistence.add(job2);

    const result = await persistence.deleteMany(["test-uuid-1", "test-uuid-2"]);

    assert.strictEqual(result.successful, 2);
    assert.strictEqual(result.failed, 0);

    const retrievedJob1 = await persistence.get("test-uuid-1");
    assert.strictEqual(retrievedJob1, null);

    const retrievedJob2 = await persistence.get("test-uuid-2");
    assert.strictEqual(retrievedJob2, null);
  });
});
