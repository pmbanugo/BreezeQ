import hyperid from "hyperid";
import {
  Job,
  JobStatus,
  PersistenceBase,
  BatchUpdateOperation,
  BatchOperationResult,
} from "./types.js";

export class MemoryPersistence implements PersistenceBase {
  private jobs: Map<string, Job> = new Map();
  private generateId = hyperid();

  async add(job: Omit<Job, "created_at" | "updated_at">): Promise<string> {
    const now = new Date();

    // If UUID is provided, use it (for client-generated UUIDs with idempotency)
    const uuid = job.uuid || this.generateId();

    // Check if job with this UUID already exists (idempotency)
    if (this.jobs.has(uuid)) {
      return uuid;
    }

    const newJob: Job = {
      ...job,
      uuid,
      created_at: now,
      updated_at: now,
      retries_left: job.options.retries || 0,
    };

    this.jobs.set(uuid, newJob);
    return uuid;
  }

  async get(uuid: string): Promise<Job | null> {
    return this.jobs.get(uuid) || null;
  }

  async update(uuid: string, data: Partial<Job>): Promise<void> {
    const job = this.jobs.get(uuid);
    if (!job) {
      throw new Error(`Job ${uuid} not found`);
    }

    const updatedJob = { ...job, ...data, updated_at: new Date() };
    this.jobs.set(uuid, updatedJob);
  }

  async getQueuedJobs(job_type: string): Promise<Job[]> {
    return Array.from(this.jobs.values())
      .filter((job) => job.job_type === job_type && job.status === "queued")
      .sort((a, b) => (a.options.priority || 0) - (b.options.priority || 0));
  }

  async getProcessingJobs(): Promise<Job[]> {
    return Array.from(this.jobs.values()).filter(
      (job) => job.status === "processing"
    );
  }

  async updateMany(
    operations: BatchUpdateOperation[]
  ): Promise<BatchOperationResult> {
    let successful = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const operation of operations) {
      try {
        const job = this.jobs.get(operation.uuid);
        if (!job) {
          // Job not found - skip silently as it might have been already processed/removed
          continue;
        }

        const updatedJob = {
          ...job,
          ...operation.data,
          updated_at: new Date(),
        };
        this.jobs.set(operation.uuid, updatedJob);
        successful++;
      } catch (error) {
        failed++;
        errors.push(`Failed to update job ${operation.uuid}: ${error}`);
      }
    }

    return {
      successful,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async deleteMany(uuids: string[]): Promise<BatchOperationResult> {
    let successful = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const uuid of uuids) {
      try {
        if (this.jobs.has(uuid)) {
          this.jobs.delete(uuid);
          successful++;
        }
        // Job not found - skip silently as it might have been already deleted
      } catch (error) {
        failed++;
        errors.push(`Failed to delete job ${uuid}: ${error}`);
      }
    }

    return {
      successful,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // Additional methods for testing/monitoring
  async getAllJobs(): Promise<Job[]> {
    return Array.from(this.jobs.values());
  }

  async getJobsByStatus(status: JobStatus): Promise<Job[]> {
    return Array.from(this.jobs.values()).filter(
      (job) => job.status === status
    );
  }

  async clear(): Promise<void> {
    this.jobs.clear();
  }

  getJobCount(): number {
    return this.jobs.size;
  }
}
