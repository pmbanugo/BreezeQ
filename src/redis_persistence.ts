import { createClient } from "redis";
import hyperid from "hyperid";
import {
  Job,
  PersistenceBase,
  BatchUpdateOperation,
  BatchOperationResult,
} from "./types.js";

type RedisClientType = ReturnType<typeof createClient>;

export class RedisPersistence implements PersistenceBase {
  private client: RedisClientType;
  private generateId = hyperid();

  constructor(redisUrl?: string) {
    this.client = createClient({ url: redisUrl });
  }

  async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  private jobKey(uuid: string): string {
    return `job:${uuid}`;
  }

  private queuedJobsKey(job_type: string): string {
    return `jobs:queued:${job_type}`;
  }

  private processingJobsKey(): string {
    return `jobs:processing`;
  }

  async add(job: Omit<Job, "created_at" | "updated_at">): Promise<string> {
    const now = new Date();
    const uuid = job.uuid || this.generateId();
    const jobKey = this.jobKey(uuid);

    const jobExists = await this.client.exists(jobKey);
    if (jobExists) {
      return uuid;
    }

    const newJob: Job = {
      ...job,
      uuid,
      created_at: now,
      updated_at: now,
      retries_left: job.options.retries || 0,
    };

    const jobData = JSON.stringify({
        ...newJob,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
    });

    await this.client.hSet(jobKey, "data", jobData);
    if (newJob.status === "queued") {
        await this.client.zAdd(this.queuedJobsKey(newJob.job_type), {
            score: newJob.options.priority || 0,
            value: uuid,
        });
    }


    return uuid;
  }

  async get(uuid: string): Promise<Job | null> {
    const jobData = await this.client.hGet(this.jobKey(uuid), "data");
    if (!jobData) {
      return null;
    }
    const job = JSON.parse(jobData);
    return {
        ...job,
        created_at: new Date(job.created_at),
        updated_at: new Date(job.updated_at),
    };
  }

  async update(uuid: string, data: Partial<Job>): Promise<void> {
    const job = await this.get(uuid);
    if (!job) {
      throw new Error(`Job ${uuid} not found`);
    }

    const updatedJob = { ...job, ...data, updated_at: new Date() };
    const jobData = JSON.stringify({
        ...updatedJob,
        created_at: updatedJob.created_at.toISOString(),
        updated_at: updatedJob.updated_at.toISOString(),
    });
    await this.client.hSet(this.jobKey(uuid), "data", jobData);

    if (data.status) {
        if (data.status === 'queued') {
            await this.client.sRem(this.processingJobsKey(), uuid);
            await this.client.zAdd(this.queuedJobsKey(updatedJob.job_type), {
                score: updatedJob.options.priority || 0,
                value: uuid,
            });
        } else if (data.status === 'processing') {
            await this.client.zRem(this.queuedJobsKey(job.job_type), uuid);
            await this.client.sAdd(this.processingJobsKey(), uuid);
        } else {
            await this.client.zRem(this.queuedJobsKey(job.job_type), uuid);
            await this.client.sRem(this.processingJobsKey(), uuid);
        }
    }
  }

  async getQueuedJobs(job_type: string): Promise<Job[]> {
    const jobIds = await this.client.zRange(this.queuedJobsKey(job_type), 0, -1);
    if (jobIds.length === 0) {
        return [];
    }

    const pipeline = this.client.multi();
    for (const jobId of jobIds) {
        pipeline.hGet(this.jobKey(jobId), "data");
    }

    const results = await pipeline.exec();
    const jobs: Job[] = [];
    for (const [index, result] of results.entries()) {
        if (result[0] === null && result[1]) { // Check for no error and valid data
            const jobData = JSON.parse(result[1]);
            jobs.push({
                ...jobData,
                created_at: new Date(jobData.created_at),
                updated_at: new Date(jobData.updated_at),
            });
        }
    }
    return jobs;
  }

  async getProcessingJobs(): Promise<Job[]> {
    const jobIds = await this.client.sMembers(this.processingJobsKey());
    if (jobIds.length === 0) {
        return [];
    }

    const pipeline = this.client.multi();
    for (const jobId of jobIds) {
        pipeline.hGet(this.jobKey(jobId), "data");
    }

    const results = await pipeline.exec();
    const jobs: Job[] = [];

    for (const [err, jobData] of results) {
        if (!err && jobData) {
            const job: Job = JSON.parse(jobData);
            jobs.push(job);
        }
    }
    return jobs;
  }

  async updateMany(
    operations: BatchUpdateOperation[]
  ): Promise<BatchOperationResult> {
    const multi = this.client.multi();
    let successful = 0;
    let failed = 0;

    const jobKeys = operations.map(op => this.jobKey(op.uuid));
    const jobDataList = await this.client.mGet(jobKeys);

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const jobData = jobDataList[i];
      if (jobData) {
        const job = JSON.parse(jobData);
        const updatedJob = { ...job, ...op.data, updated_at: new Date() };
        const updatedJobData = JSON.stringify({
            ...updatedJob,
            created_at: updatedJob.created_at.toISOString(),
            updated_at: updatedJob.updated_at.toISOString(),
        });
        multi.hSet(this.jobKey(op.uuid), "data", updatedJobData);
        successful++;
      } else {
        failed++;
      }
    }

    await multi.exec();
    return { successful, failed };
  }

  async deleteMany(uuids: string[]): Promise<BatchOperationResult> {
    const multi = this.client.multi();
    let successful = 0;
    let failed = 0;

    for (const uuid of uuids) {
        const job = await this.get(uuid);
        if (job) {
            multi.del(this.jobKey(uuid));
            multi.zRem(this.queuedJobsKey(job.job_type), uuid);
            multi.sRem(this.processingJobsKey(), uuid);
            successful++;
        } else {
            failed++;
        }
    }

    await multi.exec();
    return { successful, failed };
  }

  async clear(): Promise<void> {
    await this.client.flushDb();
  }
}
