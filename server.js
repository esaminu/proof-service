const express = require('express');
const snarkjs = require('snarkjs');
const Queue = require('bull');

const app = express();
app.use(express.json());

// Create a new queue
const proofQueue = new Queue('proof generation', process.env.REDIS_URL);

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
    const result = job.returnvalue;
    res.json({ id: job.id, state, result });
  } catch (error) {
    console.error('Error fetching job status:', error);
    res.status(500).json({ error: 'Failed to fetch job status' });
  }
});

// Worker process
proofQueue.process(async (job) => {
  console.log(`Processing job ${job.id}`);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    job.data.input,
    'rsa_verify.wasm',
    'rsa_verify_0001.zkey'
  );
  console.log(`Completed job ${job.id}`);
  return { proof, publicSignals };
});

// Error handler for the queue
proofQueue.on('error', (error) => {
  console.error('Queue error:', error);
});

// Optional: log completed jobs
proofQueue.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed. Result:`, result);
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Proof generation service listening on port ${port}`);
});