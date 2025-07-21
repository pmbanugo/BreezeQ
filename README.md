# BreezeQ - Enqueue. Dequeue. Done with ease.

[![JSR](https://jsr.io/badges/@pmbanugo/breezeq)](https://jsr.io/@pmbanugo/breezeq)

A fast, reliable, and scalable background job processing system for Node.js built on ZeroMQ. BreezeQ implements a custom Job Queue Protocol (JQP), providing enterprise-grade features for background task processing.

## Features

- **🚀 High Performance**: Built on ZeroMQ for maximum throughput and low latency
- **🔄 Reliable Processing**: Automatic job retry, timeout handling, and worker failure recovery
- **⚡ Scalable**: Horizontal and vertical scaling with multiple workers and brokers (multi-thread/multi-process)
- **💾 Flexible Persistence**: Pluggable storage backends (in-memory included, others to be included later)
- **❤️ Health Monitoring**: Built-in heartbeat system for worker and broker liveness
- **🎯 Job Prioritization**: Priority-based job queue processing (not ready)
- **🔐 Type Safe**: Full TypeScript support with comprehensive type definitions
- **📊 Monitoring**: Built-in state inspection and metrics

## Quick Start

### Installation

```bash
# Using JSR (recommended)
npx jsr add @pmbanugo/breezeq
pnpm i jsr:@pmbanugo/breezeq
yarn add jsr:@pmbanugo/breezeq
vlt install jsr:@pmbanugo/breezeq

# Using JSR with pnpm 10.8 or older, yarn 4.8 or older
pnpm dlx jsr add @pmbanugo/breezeq
yarn dlx jsr add @pmbanugo/breezeq

# Using npm registry (not yet available)
npm install @pmbanugo/breezeq
pnpm add @pmbanugo/breezeq
yarn add @pmbanugo/breezeq
```

### Basic Example

Here's a complete example you can copy and run:

```typescript
import {
  JQPBroker,
  JQPWorker,
  MemoryPersistence,
  JQPClient,
} from "@pmbanugo/breezeq";

// 1. Create a custom worker
class EmailWorker extends JQPWorker {
  constructor(brokerAddress: string) {
    super(brokerAddress, "email.send");
  }

  protected async processJob(payload: string): Promise<string> {
    const emailData = JSON.parse(payload);

    // Simulate email sending
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return JSON.stringify({
      messageId: `msg_${Date.now()}`,
      to: emailData.to,
      status: "sent",
    });
  }
}

// 2. Start the system
async function main() {
  // Start broker
  const persistence = new MemoryPersistence();
  const broker = new JQPBroker(
    {
      frontend_port: 5550,
      backend_port: 5551,
      database_path: ":memory:",
      heartbeat_interval: 2500,
      liveness_factor: 3,
      default_job_timeout: 60000,
      default_retry_count: 3,
    },
    persistence
  );

  await broker.start();

  // Start worker
  const worker = new EmailWorker("tcp://localhost:5551");
  await worker.start();

  // Create client and submit jobs
  const client = new JQPClient("tcp://localhost:5550");
  await client.connect();

  // Fire-and-forget job
  const jobId = await client.enqueueJob({
    job_type: "email.send",
    payload: JSON.stringify({
      to: "user@example.com",
      subject: "Welcome!",
      body: "Thanks for signing up.",
    }),
  });

  console.log(`Job queued: ${jobId}`);

  // Wait for job completion
  const result = await client.submitJobAndWait({
    job_type: "email.send",
    payload: JSON.stringify({
      to: "admin@example.com",
      subject: "Report ready",
      body: "Your monthly report is ready.",
    }),
  });

  console.log(`Job result: ${result}`);

  // Cleanup
  await client.disconnect();
  await worker.stop();
  await broker.stop();
}

main().catch(console.error);
```

## Architecture

BreezeQ follows a broker-worker pattern with three main components:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Client    │───▶│   Broker    │◀───│   Worker    │
│             │    │             │    │             │
│ Submit Jobs │    │ Queue Jobs  │    │ Process Jobs│
│ Get Status  │    │ Route Jobs  │    │ Send Results│
└─────────────┘    │ Monitor     │    └─────────────┘
                   │ Health      │
                   └─────────────┘
                        │
                   ┌─────────────┐
                   │ Persistence │
                   │   Layer     │
                   └─────────────┘
```

- **Broker**: Central coordinator that manages job queues, routes jobs to workers, and handles failures
- **Worker**: Processes jobs of specific types and reports results back to the broker
- **Client**: Submits jobs and retrieves results
- **Persistence**: Stores job state and metadata (pluggable storage backend)

## API Reference

### Broker

The broker is the central coordinator that manages the job queue system.

```typescript
import { JQPBroker, MemoryPersistence, BrokerConfig } from "@pmbanugo/breezeq";

const config: BrokerConfig = {
  frontend_port: 5550, // Port for client connections
  backend_port: 5551, // Port for worker connections
  database_path: ":memory:", // Database path for persistence
  heartbeat_interval: 2500, // Heartbeat interval in ms
  liveness_factor: 3, // Heartbeat missed before disconnect
  default_job_timeout: 60000, // Default job timeout in ms
  default_retry_count: 3, // Default retry attempts
};

const broker = new JQPBroker(config, new MemoryPersistence());

// Start the broker
await broker.start();

// Get broker state for monitoring
const state = broker.getState();
console.log(`Workers: ${state.workers.size}`);

// Stop the broker
await broker.stop();
```

### Client

The client submits jobs and retrieves results.

```typescript
import { JQPClient, ClientConfig } from "@pmbanugo/breezeq";

const clientConfig: ClientConfig = {
  timeout: 5000, // Request timeout in ms
  maxRetries: 3, // Max retry attempts
  retryDelay: 1000, // Delay between retries
};

const client = new JQPClient("tcp://localhost:5550", clientConfig);
await client.connect();

// Submit a job (fire-and-forget)
const jobId = await client.enqueueJob({
  job_type: "image.resize",
  payload: JSON.stringify({ url: "image.jpg", width: 300 }),
  options: {
    priority: 5, // Higher number = higher priority
    retries: 2, // Job-specific retry count
    timeout: 30000, // Job-specific timeout
  },
});

// Check job status
const status = await client.getJobStatus(jobId);
console.log(status.status); // "queued" | "processing" | "completed" | "failed"

// Submit job and wait for completion
const result = await client.submitJobAndWait(
  {
    job_type: "data.process",
    payload: JSON.stringify({ data: [1, 2, 3] }),
  },
  1000,
  30000
); // pollInterval, maxWaitTime

await client.disconnect();
```

### Worker

Workers process jobs of specific types.

```typescript
import { JQPWorker, JobOptions } from "@pmbanugo/breezeq";

class ImageWorker extends JQPWorker {
  constructor(brokerAddress: string) {
    super(brokerAddress, "image.resize", {
      heartbeatInterval: 2500, // Optional: custom heartbeat interval
      livenessFactor: 3, // Optional: custom liveness factor
    });
  }

  protected async processJob(
    payload: string,
    options: JobOptions
  ): Promise<string> {
    const { url, width, height } = JSON.parse(payload);

    // Your job processing logic here
    const processedImageUrl = await resizeImage(url, width, height);

    return JSON.stringify({
      originalUrl: url,
      processedUrl: processedImageUrl,
      dimensions: { width, height },
      processedAt: new Date().toISOString(),
    });
  }
}

const worker = new ImageWorker("tcp://localhost:5551");
await worker.start();

// Get worker state
const state = worker.getState();
console.log(`Worker running: ${state.running}`);

await worker.stop();
```

### Persistence

Implement custom persistence backends by extending `PersistenceBase`:

```typescript
import {
  PersistenceBase,
  Job,
  BatchUpdateOperation,
  BatchOperationResult,
} from "@pmbanugo/breezeq";

class DatabasePersistence implements PersistenceBase {
  async add(job: Omit<Job, "created_at" | "updated_at">): Promise<string> {
    // Store job in your database
    return job.uuid;
  }

  async get(uuid: string): Promise<Job | null> {
    // Retrieve job from database
    return null;
  }

  async update(uuid: string, data: Partial<Job>): Promise<void> {
    // Update job in database
  }

  async getQueuedJobs(job_type: string): Promise<Job[]> {
    // Get queued jobs of specific type, ordered by priority
    return [];
  }

  async getProcessingJobs(): Promise<Job[]> {
    // Get all currently processing jobs
    return [];
  }

  async updateMany(
    operations: BatchUpdateOperation[]
  ): Promise<BatchOperationResult> {
    // Batch update operations for efficiency
    return { successful: 0, failed: 0 };
  }

  async deleteMany(uuids: string[]): Promise<BatchOperationResult> {
    // Batch delete operations
    return { successful: 0, failed: 0 };
  }
}
```

## Usage Patterns

### Fire-and-Forget Jobs

Perfect for notifications, logging, analytics:

```typescript
// Submit job without waiting for result
const jobId = await client.enqueueJob({
  job_type: "analytics.track",
  payload: JSON.stringify({ event: "user_signup", userId: 123 }),
});
```

### Synchronous Processing

For immediate results like calculations or data transformation:

```typescript
const result = await client.submitJobAndWait({
  job_type: "data.transform",
  payload: JSON.stringify({ data: rawData }),
});
```

### Batch Processing

For processing multiple items with progress monitoring:

```typescript
const items = ["file1.txt", "file2.txt", "file3.txt"];
const jobIds = [];

// Submit all jobs
for (const item of items) {
  const jobId = await client.enqueueJob({
    job_type: "file.process",
    payload: JSON.stringify({ filename: item }),
  });
  jobIds.push(jobId);
}

// Monitor progress
let completed = 0;
while (completed < jobIds.length) {
  await new Promise((resolve) => setTimeout(resolve, 1000));

  for (const jobId of jobIds) {
    const status = await client.getJobStatus(jobId);
    if (status.status === "completed" || status.status === "failed") {
      completed++;
    }
  }

  console.log(`Progress: ${completed}/${jobIds.length}`);
}
```

### Concurrent Processing

For parallel execution of independent jobs:

```typescript
const jobs = [
  { job_type: "calc.add", payload: JSON.stringify({ numbers: [1, 2, 3] }) },
  {
    job_type: "calc.multiply",
    payload: JSON.stringify({ numbers: [4, 5, 6] }),
  },
  { job_type: "calc.subtract", payload: JSON.stringify({ numbers: [10, 3] }) },
];

const results = await Promise.all(
  jobs.map((job) => client.submitJobAndWait(job))
);
```

## Configuration

### Default Configuration

```typescript
export const DEFAULT_CONFIG = {
  frontend_port: 5550,
  backend_port: 5551,
  database_path: ":memory:",
  heartbeat_interval: 2500, // 2.5 seconds
  liveness_factor: 3, // 3 missed heartbeats = dead
  default_job_timeout: 60000, // 60 seconds
  default_retry_count: 3,
};
```

### Environment-based Configuration

```typescript
const config: BrokerConfig = {
  frontend_port: parseInt(process.env.FRONTEND_PORT || "5550"),
  backend_port: parseInt(process.env.BACKEND_PORT || "5551"),
  database_path: process.env.DB_PATH || ":memory:",
  heartbeat_interval: parseInt(process.env.HEARTBEAT_INTERVAL || "2500"),
  liveness_factor: parseInt(process.env.LIVENESS_FACTOR || "3"),
  default_job_timeout: parseInt(process.env.JOB_TIMEOUT || "60000"),
  default_retry_count: parseInt(process.env.RETRY_COUNT || "3"),
};
```

## Error Handling

BreezeQ provides comprehensive error handling:

```typescript
try {
  const result = await client.submitJobAndWait({
    job_type: "risky.operation",
    payload: JSON.stringify({ data: "test" }),
  });
} catch (error) {
  if (error.message.includes("timeout")) {
    console.log("Job timed out");
  } else if (error.message.includes("failed")) {
    console.log("Job processing failed");
  } else {
    console.log("Network or client error");
  }
}
```

## Monitoring and Observability

### Broker State

```typescript
const state = broker.getState();
console.log(`Active workers: ${state.workers.size}`);
console.log(`Processing jobs: ${state.processingJobs.size}`);
console.log(`Ready workers by type:`, state.ready_workers);
```

### Worker State

```typescript
const workerState = worker.getState();
console.log(`Worker type: ${workerState.jobType}`);
console.log(`Running: ${workerState.running}`);
console.log(`Last heartbeat: ${workerState.lastHeartbeat}`);
```

### Client State

```typescript
const clientState = client.getState();
console.log(`Connected: ${clientState.connected}`);
console.log(`Pending requests: ${clientState.pendingRequests}`);
```

## Best Practices

1. **Resource Management**: Always call `stop()` or `disconnect()` in your cleanup code
2. **Error Handling**: Implement proper error handling in your worker's `processJob` method
3. **Graceful Shutdown**: Use process signal handlers to gracefully shutdown brokers and workers
4. **Monitoring**: Regularly check broker and worker states in production
5. **Job Idempotency**: Design jobs to be idempotent for safe retries
6. **Payload Size**: Keep job payloads reasonably small for better performance. Jobs are serialized-strings, a future version would default to a something like protobuf or CBOR.
7. **Worker Scaling**: Scale workers horizontally based on queue depth and processing time

## Protocol

BreezeQ implements the Job Queue Protocol (JQP), a custom protocol based on ZeroMQ sockets. The protocol specification is programming language agnostic, and intentionally kept private.

## Contributing

TBD

## License

Apache 2.0 License - see LICENSE file for details.
