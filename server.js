const express = require('express');
const snarkjs = require('snarkjs');

const app = express();
app.use(express.json());

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
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      'rsa_verify.wasm',
      'rsa_verify_0001.zkey'
    );
    res.json({ proof, publicSignals });
  } catch (error) {
    console.error('Proof generation error:', error);
    res.status(500).json({ error: 'Proof generation failed' });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Proof generation service listening on port ${port}`);
});
