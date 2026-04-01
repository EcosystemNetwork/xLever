// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0; // Solidity 0.8+ for compatibility with the rest of the project

import "forge-std/Script.sol"; // Foundry Script base for console.log -- this script only prints instructions

// Minimal EVC interface for deployment reference // placeholder contract -- actual EVC lives in a separate repo
// Note: Actual EVC should be deployed from ethereum-vault-connector repo // EVC cannot be deployed from this repo due to separate dependency tree
contract DeployEVC is Script { // informational script that guides the operator through EVC deployment
    function run() external view { // view-only -- does not deploy anything, just prints instructions
        console.log("=== EVC Deployment Instructions ==="); // header for instruction output
        console.log(""); // blank line for readability
        console.log("The Ethereum Vault Connector (EVC) should be deployed from its official repository:"); // EVC must come from its own repo to get correct bytecode
        console.log("https://github.com/euler-xyz/ethereum-vault-connector"); // official EVC repository URL
        console.log(""); // blank line
        console.log("Steps:"); // numbered steps for operator
        console.log("1. Clone the EVC repository:"); // step 1: get the source code
        console.log("   git clone https://github.com/euler-xyz/ethereum-vault-connector.git"); // git clone command
        console.log(""); // blank line
        console.log("2. Navigate to the directory and install dependencies:"); // step 2: set up build environment
        console.log("   cd ethereum-vault-connector && forge install"); // install Foundry dependencies
        console.log(""); // blank line
        console.log("3. Deploy EVC to Ink Sepolia:"); // step 3: actual deployment command
        console.log("   forge create src/EthereumVaultConnector.sol:EthereumVaultConnector \\"); // forge create deploys a single contract
        console.log("     --rpc-url $RPC_URL \\"); // point to Ink Sepolia RPC
        console.log("     --private-key $PRIVATE_KEY"); // sign with deployer key
        console.log(""); // blank line
        console.log("4. Copy the deployed address to your .env file:"); // step 4: save the address for vault kit deployment
        console.log("   EVC_ADDRESS=0x..."); // env var format expected by other scripts
        console.log(""); // blank line
        console.log("Alternatively, check if EVC is already deployed on Ink Sepolia"); // may already exist -- avoid duplicate deployment
        console.log("and use that address instead."); // reuse existing deployment if available
    }
}
