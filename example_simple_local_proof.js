const snarkjs = require('snarkjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const token = "YOUR_TOKEN_HERE";

const publicKeyN = "1BqxSPBr-Fap-E39TLXfuDg0Bfg05zYqhvVvEVhfPXRkPj7M8uK_1MOb-11XKaZ4IkWMJIwRJlT7DvDqpktDLxvTkL5Z5CLkX63TzDMK1LL2AK36sSqPthy1FTDNmDMry867pfjy_tktKjsI_lC40IKZwmVXEqGS2vl7c8URQVgbpXwRDKSr_WKIR7IIB-FMNaNWC3ugWYkLW-37zcqwd0uDrDQSJ9oPX0HkPKq99Imjhsot4x5i6rtLSQgSD7Q3lq1kvcEu6i4KhG4pA0yRZQmGCr4pzi7udG7eKTMYyJiq5HoFA446fdk6v0mWs9C7Cl3R_G45S_dH0M8dxR_zPQ"

function base64UrlToBase64(base64Url) {
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    return base64;
}

function base64UrlDecode(str) {
    return Buffer.from(base64UrlToBase64(str), 'base64').toString('utf-8');
}

function bigintToArray(n, k, x) {
    let mod = 1n;
    for (let i = 0; i < n; i++) {
        mod = mod * 2n;
    }

    let ret = [];
    let x_temp = BigInt(x);
    for (let i = 0; i < k; i++) {
        ret.push((x_temp % mod).toString());
        x_temp = x_temp / mod;
    }
    return ret;
}

async function verifyToken() {
    // Decode the token
    const [headerB64, payloadB64, signatureB64] = token.split('.');

    // Convert signature to bigInt array
    const signature = Buffer.from(base64UrlToBase64(signatureB64), 'base64');
    const signBigInt = BigInt(`0x${signature.toString('hex')}`);
    const signArray = bigintToArray(64, 32, signBigInt);

    // Convert modulus to bigInt array
    const modulusBigInt = BigInt(`0x${Buffer.from(base64UrlToBase64(publicKey.n), 'base64').toString('hex')}`);
    const modulusArray = bigintToArray(64, 32, modulusBigInt);

    // Hash the header and payload
    const data = `${headerB64}.${payloadB64}`;
    const hash = crypto.createHash('sha256').update(data).digest();
    const hashedBigInt = BigInt(`0x${hash.toString('hex')}`);
    const hashedArray = bigintToArray(64, 4, hashedBigInt);

    // Prepare exponent
    const expArray = bigintToArray(64, 32, BigInt(65537));

    // Prepare input for the circuit
    const input = {
        exp: expArray,
        sign: signArray,
        modulus: modulusArray,
        hashed: hashedArray,
        payload:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
    };

    console.log('Input prepared for the circuit:');
    console.log(JSON.stringify(input, null, 2));

    try {
        // Generate the proof
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            input,
            path.join(__dirname, "rsa_verify.wasm"),
            path.join(__dirname, "rsa_verify_0001.zkey")
        );
        
        console.log("Proof generated successfully");

        // Verify the proof
        const vKeyJson = JSON.parse(fs.readFileSync(path.join(__dirname, "verification_key.json"), 'utf-8'));
        const res = await snarkjs.groth16.verify(vKeyJson, publicSignals, proof);

        if (res === true) {
            console.log("The signature is valid!");
        } else {
            console.log("The signature is NOT valid!");
        }
    } catch (error) {
        console.error("Error during proof generation or verification:", error);
    }
}

verifyToken();
