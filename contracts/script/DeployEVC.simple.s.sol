// SPDX-License-Identifier: GPL-2.0-or-later // required license header for Euler-derived code compatibility
pragma solidity ^0.8.0; // Solidity 0.8+ for compatibility with the rest of the project

import "forge-std/Script.sol"; // Foundry Script base for console.log -- this script only prints instructions

// Simple script to deploy EVC from the ethereum-vault-connector repository // EVC is an external dependency that must be deployed separately
// This is a placeholder - actual EVC deployment should be done from the EVC repo // this repo does not contain the EVC source code

contract DeployEVCSimple is Script { // informational script that provides two options for EVC deployment
    function run() external { // entry point -- prints instructions to console without deploying anything
        console.log("=== EVC Deployment Required ==="); // header emphasizing EVC is a prerequisite
        console.log(""); // blank line for readability
        console.log("Before deploying Euler Vault Kit, you need to deploy the EVC."); // EVC must exist before vaults can be created
        console.log(""); // blank line
        console.log("Option 1: Deploy EVC yourself"); // self-deployment option for operators with no existing EVC
        console.log("  cd /home/remsee/xLeverContracts"); // navigate to the project root directory
        console.log("  git clone https://github.com/euler-xyz/ethereum-vault-connector.git evc"); // clone EVC repo into an 'evc' subdirectory
        console.log("  cd evc"); // enter the cloned EVC directory
        console.log("  forge install"); // install EVC's Foundry dependencies
        console.log("  forge create src/EthereumVaultConnector.sol:EthereumVaultConnector \\"); // deploy EVC contract to Ink Sepolia
        console.log("    --rpc-url https://rpc-gel-sepolia.inkonchain.com \\"); // Ink Sepolia RPC endpoint
        console.log("    --private-key <YOUR_PRIVATE_KEY>"); // sign deployment with operator's private key
        console.log(""); // blank line
        console.log("Option 2: Check if EVC is already deployed on Ink Sepolia"); // reuse option to avoid redundant deployment
        console.log("  Contact Euler team or check their documentation"); // Euler may have already deployed EVC on this testnet
        console.log(""); // blank line
        console.log("After deployment, add the EVC address to your .env file:"); // all downstream scripts read EVC_ADDRESS from .env
        console.log("  EVC_ADDRESS=0x..."); // expected env var format
        console.log(""); // blank line
        console.log("Then run the main deployment script again."); // once EVC is set, DeployAll or DeployEulerVaultKit can proceed
    }
}
