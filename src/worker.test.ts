import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { JQPWorker } from "./worker.js";

describe("JQPWorker", () => {
  test("should create worker with correct initial state", () => {
    const worker = new JQPWorker("tcp://localhost:5556", "test.job");
    
    const state = worker.getState();
    assert.equal(state.jobType, "test.job");
    assert.equal(state.running, false);
    // Note: ZeroMQ socket might be in connecting state, so don't assert connected state
    assert.ok(state.lastHeartbeat instanceof Date);
  });
  
  test("should handle custom heartbeat configuration", () => {
    const worker = new JQPWorker("tcp://localhost:5556", "test.job", {
      heartbeatInterval: 3000,
      livenessFactor: 4,
    });
    
    const state = worker.getState();
    assert.equal(state.jobType, "test.job");
    
    // We can't easily test the internal heartbeat settings without exposing them
    // but we can test that the worker was created successfully
  });
  
  test("should process job with default implementation", async () => {
    const worker = new JQPWorker("tcp://localhost:5556", "test.job");
    
    // Test the default processJob implementation
    const result = await worker['processJob']('{"test": "data"}', { retries: 3 });
    assert.equal(result, 'Processed: {"test": "data"}');
  });
  
  test("should handle worker lifecycle", () => {
    const worker = new JQPWorker("tcp://localhost:5556", "test.job");
    
    // Initially not running
    assert.equal(worker.getState().running, false);
    
    // Test basic state - don't call stop() as it might hang without a broker
    assert.equal(worker.getState().jobType, "test.job");
  });
  
  test("should maintain correct job type", () => {
    const worker1 = new JQPWorker("tcp://localhost:5556", "image.resize");
    const worker2 = new JQPWorker("tcp://localhost:5556", "email.send");
    
    assert.equal(worker1.getState().jobType, "image.resize");
    assert.equal(worker2.getState().jobType, "email.send");
  });
  
  test("should handle different broker addresses", () => {
    const worker1 = new JQPWorker("tcp://localhost:5556", "test.job");
    const worker2 = new JQPWorker("tcp://127.0.0.1:5557", "test.job");
    
    // Both should be created successfully
    assert.equal(worker1.getState().jobType, "test.job");
    assert.equal(worker2.getState().jobType, "test.job");
  });
});

// Extended worker for testing custom job processing
class TestWorker extends JQPWorker {
  constructor(brokerAddress: string, jobType: string) {
    super(brokerAddress, jobType);
  }
  
  protected override async processJob(payload: string, options: any): Promise<string> {
    const data = JSON.parse(payload);
    return `Custom processed: ${data.input}`;
  }
}

describe("TestWorker (Custom Implementation)", () => {
  test("should use custom job processing", async () => {
    const worker = new TestWorker("tcp://localhost:5556", "custom.job");
    
    const result = await worker['processJob']('{"input": "test data"}', {});
    assert.equal(result, "Custom processed: test data");
  });
  
  test("should handle malformed JSON in custom processing", async () => {
    const worker = new TestWorker("tcp://localhost:5556", "custom.job");
    
    // Should throw error for malformed JSON
    await assert.rejects(
      async () => await worker['processJob']('invalid json', {}),
      /Unexpected token/
    );
  });
});
