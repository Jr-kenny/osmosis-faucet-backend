const express = require('express');
const { DirectSecp256k1HdWallet } = require('@cosmjs/proto-signing');
const { SigningStargateClient } = require('@cosmjs/stargate');
const { coins } = require('@cosmjs/stargate');
const fs = require('fs');

const app = express();
app.use(express.json());

// Load seed phrase from environment variables
const MNEMONIC = process.env.MNEMONIC;
const RPC_ENDPOINT = "https://rpc.osmotest5.osmosis.zone";
const FAUCET_AMOUNT = "100000"; 
const WALLET_LIMIT = 2;
const DATA_FILE = 'requests.json';

// Set up CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

const loadRequests = () => {
    if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
    return {};
};

const saveRequests = (data) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

const resetDailyCount = () => {
    const now = new Date();
    const requests = loadRequests();
    let newRequests = {};
    const today = now.toISOString().split('T')[0];

    for (const [address, data] of Object.entries(requests)) {
        if (data.date === today) {
            newRequests[address] = data;
        }
    }
    saveRequests(newRequests);
};

const now = new Date();
const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
const msUntilMidnight = nextMidnight.getTime() - now.getTime();
setTimeout(() => {
    resetDailyCount();
    setInterval(resetDailyCount, 1000 * 60 * 60 * 24);
}, msUntilMidnight);


app.post('/', async (req, res) => {
    const { wallet } = req.body;
    const requests = loadRequests();
    const today = new Date().toISOString().split('T')[0];

    if (!MNEMONIC) {
        return res.status(500).json({ message: 'Seed phrase not configured.' });
    }

    if (!wallet) {
        return res.status(400).json({ message: 'Wallet address is required.' });
    }

    if (requests[wallet] && requests[wallet].date === today) {
        if (requests[wallet].count >= WALLET_LIMIT) {
            return res.status(429).json({ message: 'This wallet has reached its daily request limit.' });
        }
    }
    
    try {
        const walletSigner = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, { prefix: "osmo" });
        const [firstAccount] = await walletSigner.getAccounts();
        const client = await SigningStargateClient.connectWithSigner(RPC_ENDPOINT, walletSigner);

        const amount = coins(FAUCET_AMOUNT, "uosmo");
        const fee = {
            amount: coins(5000, "uosmo"),
            gas: "200000",
        };

        const txResponse = await client.sendTokens(firstAccount.address, wallet, amount, fee);

        if (txResponse.code !== undefined && txResponse.code !== 0) {
            return res.status(500).json({ message: 'Transaction failed. Please try again.' });
        }
        
        if (!requests[wallet]) {
            requests[wallet] = { count: 0, date: today };
        }
        requests[wallet].count++;
        saveRequests(requests);

        return res.status(200).json({ message: `Successfully sent 0.1 OSMO to ${wallet}` });

    } catch (error) {
        return res.status(500).json({ message: `Failed to send tokens. Error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Faucet backend listening on port ${PORT}`);
});
