const express = require('express');
const snarkjs = require('snarkjs');

const app = express();
app.use(express.json());

app.post('/generate-proof', async (req, res) => {
  try {
    const { input } = req.body;
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      'circuit.wasm',
      'circuit_final.zkey'
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