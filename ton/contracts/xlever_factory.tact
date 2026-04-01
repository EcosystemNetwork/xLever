// ═══════════════════════════════════════════════════════════════
// xLever Factory — TON (Tact)
// ═══════════════════════════════════════════════════════════════
// Deploys and tracks XLeverVault child contracts.
// Admin-only vault creation via CreateVault message.
// ═══════════════════════════════════════════════════════════════

import "./messages.tact";
import "./xlever_vault.tact";

struct VaultRecord {
    vault_address: Address;
    asset_symbol: String;
    pyth_feed_id: Int as uint256;
    created_at: Int as uint64;
}

contract XLeverFactory {
    owner: Address;
    vault_count: Int as uint32;
    vaults_by_id: map<Int, VaultRecord>;
    vault_id_by_symbol: map<Int, Int>;   // hash(symbol) => vault_id

    // Default USDC Jetton master address (set on deploy, updateable)
    default_usdc_address: Address;

    init(owner: Address, default_usdc_address: Address) {
        self.owner = owner;
        self.vault_count = 0;
        self.default_usdc_address = default_usdc_address;
    }

    // ═══════════════════════════════════════════════════════════
    // VAULT CREATION (admin only)
    // ═══════════════════════════════════════════════════════════

    receive(msg: CreateVault) {
        require(sender() == self.owner, "Only owner can create vaults");
        require(context().value >= ton("0.1"), "Insufficient TON for vault deployment");

        let vault_id: Int = self.vault_count;
        let usdc: Address = msg.usdc_address;

        // Compute the vault init state — this deterministically gives us the address
        let vault_init: StateInit = initOf XLeverVault(
            myAddress(),           // factory is the owner of each vault
            vault_id,
            msg.asset_symbol,
            usdc,
            msg.pyth_feed_id
        );
        let vault_address: Address = contractAddress(vault_init);

        // Deploy the vault by sending it a message with its StateInit
        send(SendParameters{
            to: vault_address,
            value: ton("0.05"),
            mode: 0,
            code: vault_init.code,
            data: vault_init.data,
            body: "deploy".asComment()
        });

        // Record the vault
        let record: VaultRecord = VaultRecord{
            vault_address: vault_address,
            asset_symbol: msg.asset_symbol,
            pyth_feed_id: msg.pyth_feed_id,
            created_at: now()
        };
        self.vaults_by_id.set(vault_id, record);

        // Store symbol hash for lookup
        let sym_hash: Int = sha256(msg.asset_symbol);
        self.vault_id_by_symbol.set(sym_hash, vault_id);

        self.vault_count = self.vault_count + 1;

        // Notify the creator
        send(SendParameters{
            to: sender(),
            value: 0,
            mode: SendRemainingValue,
            body: VaultCreated{
                vault_address: vault_address,
                asset_symbol: msg.asset_symbol,
                query_id: msg.query_id
            }.toCell()
        });
    }

    // ═══════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════

    receive("update_usdc") {
        require(sender() == self.owner, "Only owner");
        // In production, parse the new address from the message body.
        // For now this is a placeholder for the admin flow.
    }

    // ═══════════════════════════════════════════════════════════
    // BOUNCED HANDLING
    // ═══════════════════════════════════════════════════════════

    bounced(src: bounced<VaultCreated>) {
        // If vault creation notification bounces, log but don't revert
        // The vault is already deployed on-chain; only the notification failed.
    }

    // ═══════════════════════════════════════════════════════════
    // GETTERS
    // ═══════════════════════════════════════════════════════════

    get fun vaultCount(): Int {
        return self.vault_count;
    }

    get fun getVault(vault_id: Int): VaultRecord? {
        return self.vaults_by_id.get(vault_id);
    }

    get fun getVaultAddressBySymbol(symbol: String): Address? {
        let sym_hash: Int = sha256(symbol);
        let vid: Int? = self.vault_id_by_symbol.get(sym_hash);
        if (vid == null) {
            return null;
        }
        let record: VaultRecord? = self.vaults_by_id.get(vid!!);
        if (record == null) {
            return null;
        }
        return record!!.vault_address;
    }

    get fun getVaultAddress(vault_id: Int, asset_symbol: String, usdc_address: Address, pyth_feed_id: Int): Address {
        let vault_init: StateInit = initOf XLeverVault(
            myAddress(),
            vault_id,
            asset_symbol,
            usdc_address,
            pyth_feed_id
        );
        return contractAddress(vault_init);
    }

    get fun owner(): Address {
        return self.owner;
    }

    get fun defaultUsdcAddress(): Address {
        return self.default_usdc_address;
    }
}
