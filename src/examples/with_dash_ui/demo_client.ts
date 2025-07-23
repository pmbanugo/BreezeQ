import { JQPClient, EnqueueJobRequest } from "../../client.js";
import { randomUUID } from "node:crypto";

export interface DemoClientConfig {
  brokerHost?: string;
  brokerPort: number;
  jobSubmissionInterval?: number;
  jobTypes?: string[];
  maxJobs?: number;
}

/**
 * Demo client that continuously submits jobs for testing the dashboard
 */
export class DemoClient {
  private client: JQPClient;
  private config: DemoClientConfig;
  private isRunning = false;
  private submissionTimer?: NodeJS.Timeout;
  private jobsSubmitted = 0;

  constructor(config: DemoClientConfig) {
    this.config = {
      jobSubmissionInterval: 2000, // Submit every 2 seconds by default
      jobTypes: ["math", "data-processing", "image-resize"],
      maxJobs: 1000,
      ...config
    };

    const brokerAddress = `tcp://${this.config.brokerHost || "localhost"}:${this.config.brokerPort}`;
    
    const clientConfig = {
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 1000,
    };

    this.client = new JQPClient(brokerAddress, clientConfig);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("DemoClient is already running");
    }

    console.log("Starting demo client...");
    await this.client.connect();
    
    this.isRunning = true;
    this.scheduleNextJob();
    
    console.log(`Demo client started. Will submit up to ${this.config.maxJobs} jobs.`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log("Stopping demo client...");
    this.isRunning = false;

    if (this.submissionTimer) {
      clearTimeout(this.submissionTimer);
    }

    await this.client.disconnect();
    console.log(`Demo client stopped. Submitted ${this.jobsSubmitted} jobs total.`);
  }

  private scheduleNextJob(): void {
    if (!this.isRunning || this.jobsSubmitted >= this.config.maxJobs!) {
      return;
    }

    this.submissionTimer = setTimeout(async () => {
      try {
        await this.submitRandomJob();
        this.scheduleNextJob();
      } catch (error) {
        console.error("Error submitting job:", error);
        // Still schedule the next job even if this one failed
        this.scheduleNextJob();
      }
    }, this.config.jobSubmissionInterval);
  }

  private async submitRandomJob(): Promise<void> {
    const jobTypes = this.config.jobTypes!;
    const jobType = jobTypes[Math.floor(Math.random() * jobTypes.length)];
    const jobUuid = randomUUID();
    
    // Generate different payloads based on job type
    let payload: any;
    let options: any = {
      retries: Math.floor(Math.random() * 3) + 1,
      priority: Math.floor(Math.random() * 10),
      timeout: 30000,
    };

    switch (jobType) {
      case "math":
        payload = {
          operation: ["add", "multiply", "fibonacci", "factorial"][Math.floor(Math.random() * 4)],
          values: [Math.floor(Math.random() * 100), Math.floor(Math.random() * 100)],
        };
        break;
        
      case "data-processing":
        payload = {
          action: ["sort", "filter", "transform", "aggregate"][Math.floor(Math.random() * 4)],
          data: Array.from({ length: Math.floor(Math.random() * 20) + 5 }, () => Math.floor(Math.random() * 1000)),
        };
        break;
        
      case "image-resize":
        payload = {
          imageUrl: `https://picsum.photos/${200 + Math.floor(Math.random() * 300)}/${200 + Math.floor(Math.random() * 300)}`,
          targetWidth: 200 + Math.floor(Math.random() * 200),
          targetHeight: 200 + Math.floor(Math.random() * 200),
          format: ["jpg", "png", "webp"][Math.floor(Math.random() * 3)],
        };
        break;
        
      default:
        payload = { message: `Generic job payload for ${jobType}`, timestamp: Date.now() };
    }

    try {
      const request: EnqueueJobRequest = {
        job_type: jobType,
        payload: JSON.stringify(payload),
        options: options,
      };
      
      const result = await this.client.enqueueJob(request);
      console.log(`Submitted job ${result} (${jobType})`);
      this.jobsSubmitted++;
    } catch (error) {
      console.error(`Failed to submit job ${jobUuid}:`, error);
    }
  }

  getJobsSubmitted(): number {
    return this.jobsSubmitted;
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

/**
 * Simple client for manual job submission
 */
export class SimpleClient {
  private client: JQPClient;

  constructor(brokerHost = "localhost", brokerPort = 5555) {
    const brokerAddress = `tcp://${brokerHost}:${brokerPort}`;
    
    const clientConfig = {
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 1000,
    };

    this.client = new JQPClient(brokerAddress, clientConfig);
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  async submitJob(jobType: string, payload: any, options?: any): Promise<string> {
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
    
    const request: EnqueueJobRequest = {
      job_type: jobType,
      payload: payloadStr,
      options: options || {
        retries: 2,
        priority: 0,
        timeout: 30000,
      },
    };
    
    const jobUuid = await this.client.enqueueJob(request);

    console.log(`Submitted job ${jobUuid} (${jobType})`);
    return jobUuid;
  }

  async getJobStatus(jobUuid: string): Promise<{ status: string; result?: string }> {
    const response = await this.client.getJobStatus(jobUuid);
    return {
      status: response.status,
      result: response.result,
    };
  }
}
