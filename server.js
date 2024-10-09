const express = require('express');
const Queue = require('bull');
const Redis = require('ioredis');
const { execFile } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());

function createRedisClient() {
  const redisUrl = process.env.REDIS_URL || process.env.REDIS_TLS_URL;

  if (!redisUrl) {
    console.error('Redis URL not found in environment variables');
    process.exit(1);
  }

  const client = new Redis(redisUrl, {
    tls: {
      rejectUnauthorized: false,
    },
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => {
      const delay = Math.min(times * 100, 3000);
      console.log(`Retrying Redis connection in ${delay}ms`);
      return delay;
    },
  });

  client.on('error', (error) => {
    console.error('Redis client error:', error);
  });

  client.on('connect', () => {
    console.log('Successfully connected to Redis');
  });

  client.on('close', () => {
    console.log('Redis connection closed');
  });

  return client;
}

const redisClient = createRedisClient();

// Create a new queue with the Redis client
const proofQueue = new Queue('proof generation', process.env.REDIS_URL, {
  redis: {
    tls: {
      rejectUnauthorized: false,
    },
  },
  settings: {
    lockDuration: 300000, // 5 minutes
    stalledInterval: 300000, // 5 minutes
    maxStalledCount: 1,
  },
});

proofQueue.on('error', (error) => {
  console.error('Queue error:', error);
});

const apiKeyAuth = (req, res, next) => {
  const apiKey = req.get('X-API-Key');
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.use(apiKeyAuth);

app.post('/generate-proof', async (req, res) => {
  try {
    const { input } = req.body;
    const job = await proofQueue.add({ input });
    res.json({ jobId: job.id, message: 'Proof generation job queued' });
  } catch (error) {
    console.error('Error queueing proof generation job:', error);
    res.status(500).json({ error: 'Failed to queue proof generation job' });
  }
});

app.get('/job-status/:jobId', async (req, res) => {
  try {
    const job = await proofQueue.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const state = await job.getState();
    if (state === 'completed') {
      res.json({ id: job.id, state, result: job.returnvalue });
    } else if (state === 'failed') {
      res.status(500).json({ id: job.id, state, error: 'Job failed' });
    } else {
      res.status(202).json({ id: job.id, state });
    }
  } catch (error) {
    console.error('Error fetching job status:', error);
    res.status(500).json({ error: 'Failed to fetch job status' });
  }
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`${signal} received, shutting down gracefully`);
  try {
    await proofQueue.close(5000);
    console.log('Bull queue closed');
    await redisClient.quit();
    console.log('Redis connection closed');
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
  console.log(`Proof generation service listening on port ${port}`);
});

// Ensure connections are closed when the server shuts down
server.on('close', async () => {
  console.log('HTTP server closing');
  await proofQueue.close();
  await redisClient.quit();
});

// Only start the worker process if this is the worker dyno
if (process.env.DYNO && process.env.DYNO.startsWith('worker')) {
  // Worker process
  proofQueue.process(async (job) => {
    console.log(`Processing job ${job.id}`);
    const tempFiles = [];
    try {
      // Write input to a temporary witness file
      const witnessFile = path.join('/tmp', `witness_${job.id}.wtns`);
      tempFiles.push(witnessFile);
      await fs.writeFile(witnessFile, JSON.stringify(job.data.input));

      // Define output file paths
      const proofFile = path.join('/tmp', `proof_${job.id}.json`);
      const publicFile = path.join('/tmp', `public_${job.id}.json`);
      tempFiles.push(proofFile, publicFile);

      const proverPath = path.join(__dirname, 'prover');
      const zkeyPath = path.join(__dirname, 'rsa_verify_0001.zkey');

      // Execute the prover with all required parameters
      await new Promise((resolve, reject) => {
        execFile(
          proverPath,
          [zkeyPath, witnessFile, proofFile, publicFile],
          (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve();
          }
        );
      });

      // Read the proof and public files
      const proof = JSON.parse(await fs.readFile(proofFile, 'utf8'));
      const publicSignals = JSON.parse(await fs.readFile(publicFile, 'utf8'));

      console.log(`Completed job ${job.id}`);
      return { proof, publicSignals };
    } catch (error) {
      console.error(`Error processing job ${job.id}:`, error);
      throw error;
    } finally {
      // Clean up temporary files, even if an error occurred
      await Promise.all(
        tempFiles.map((file) =>
          fs
            .unlink(file)
            .catch((err) => console.error(`Failed to delete ${file}:`, err))
        )
      );
    }
  });
}
