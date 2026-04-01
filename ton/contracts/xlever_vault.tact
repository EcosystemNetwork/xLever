// ═══════════════════════════════════════════════════════════════
// xLever Vault — TON (Tact)
// ═══════════════════════════════════════════════════════════════
// Each vault tracks one tokenized asset (e.g. QQQ, SPY, NVDA).
// Users deposit USDC with leverage from -4x to +4x.
// Junior LPs provide liquidity and earn fees.
// ═══════════════════════════════════════════════════════════════

import "./messages.tact";

// Protocol states
const STATE_ACTIVE: Int = 0;
const STATE_PAUSED: Int = 1;
const STATE_EMERGENCY: Int = 2;

// Leverage bounds in basis points
const MAX_LEVERAGE_BPS: Int = 40000;   // +4x
const MIN_LEVERAGE_BPS: Int = -40000;  // -4x

// Fee constants (basis points)
const BASE_FEE_BPS: Int = 50;         // 0.50%
const PER_UNIT_FEE_BPS: Int = 50;     // 0.50% per unit above 1x

// Minimum gas for operations
const MIN_GAS_DEPOSIT: Int = ton("0.05");
const MIN_GAS_WITHDRAW: Int = ton("0.05");

contract XLeverVault {
    // ── Immutable state ──
    owner: Address;
    vault_id: Int as uint32;
    asset_symbol: String;

    // ── Configurable state ──
    usdc_address: Address;
    pyth_feed_id: Int as uint256;

    // ── Pool accounting ──
    total_senior_deposits: Int as uint128;
    total_junior_deposits: Int as uint128;
    insurance_fund: Int as uint128;
    net_exposure: Int as int256;

    // ── Protocol control ──
    protocol_state: Int as uint8;

    // ── Position tracking ──
    positions: map<Address, Position>;
    junior_shares: map<Address, Int>;   // LP share balances
    total_junior_shares: Int as uint128;

    // ── Counters ──
    total_positions: Int as uint32;
    total_deposited_ever: Int as uint128;

    init(owner: Address, vault_id: Int, asset_symbol: String, usdc_address: Address, pyth_feed_id: Int) {
        self.owner = owner;
        self.vault_id = vault_id;
        self.asset_symbol = asset_symbol;
        self.usdc_address = usdc_address;
        self.pyth_feed_id = pyth_feed_id;

        self.total_senior_deposits = 0;
        self.total_junior_deposits = 0;
        self.insurance_fund = 0;
        self.net_exposure = 0;
        self.protocol_state = STATE_ACTIVE;

        self.total_junior_shares = 0;
        self.total_positions = 0;
        self.total_deposited_ever = 0;
    }

    // ═══════════════════════════════════════════════════════════
    // SENIOR (LEVERAGED) DEPOSITS
    // ═══════════════════════════════════════════════════════════

    receive(msg: Deposit) {
        require(self.protocol_state == STATE_ACTIVE, "Vault is not active");
        require(msg.amount > 0, "Deposit amount must be positive");
        require(msg.leverage_bps >= MIN_LEVERAGE_BPS && msg.leverage_bps <= MAX_LEVERAGE_BPS, "Leverage out of range");
        require(context().value >= MIN_GAS_DEPOSIT, "Insufficient gas");

        let sender: Address = sender();

        // Check if user already has an active position
        let existing: Position? = self.positions.get(sender);
        if (existing != null) {
            require(!(existing!!.is_active), "Position already active; close or adjust first");
        }

        // Calculate fee
        let fee: Int = self._calculateFee(msg.amount, msg.leverage_bps);
        let net_amount: Int = msg.amount - fee;
        require(net_amount > 0, "Fee exceeds deposit");

        // Check junior pool has enough liquidity for leveraged exposure
        let abs_leverage: Int = self._abs(msg.leverage_bps);
        if (abs_leverage > 10000) {
            let borrowed: Int = (net_amount * (abs_leverage - 10000)) / 10000;
            require(borrowed <= self.total_junior_deposits, "Insufficient junior liquidity");
        }

        // Create position
        let pos: Position = Position{
            deposit_amount: net_amount,
            leverage_bps: msg.leverage_bps,
            entry_twap: 0,            // Set by oracle update in production
            last_fee_timestamp: now(),
            is_active: true
        };
        self.positions.set(sender, pos);

        // Update pool state
        self.total_senior_deposits = self.total_senior_deposits + net_amount;
        self.insurance_fund = self.insurance_fund + (fee / 2);
        self.total_junior_deposits = self.total_junior_deposits + (fee - fee / 2);
        self.net_exposure = self.net_exposure + (net_amount * msg.leverage_bps) / 10000;
        self.total_positions = self.total_positions + 1;
        self.total_deposited_ever = self.total_deposited_ever + msg.amount;
    }

    receive(msg: Withdraw) {
        require(self.protocol_state != STATE_PAUSED, "Vault is paused");
        require(msg.amount > 0, "Withdraw amount must be positive");
        require(context().value >= MIN_GAS_WITHDRAW, "Insufficient gas");

        let sender: Address = sender();
        let pos: Position? = self.positions.get(sender);
        require(pos != null, "No position found");
        require(pos!!.is_active, "Position is not active");
        require(msg.amount <= pos!!.deposit_amount, "Withdraw exceeds deposit");

        let remaining: Int = pos!!.deposit_amount - msg.amount;

        if (remaining == 0) {
            // Close position entirely
            let closed: Position = Position{
                deposit_amount: 0,
                leverage_bps: 0,
                entry_twap: pos!!.entry_twap,
                last_fee_timestamp: now(),
                is_active: false
            };
            self.positions.set(sender, closed);
            self.total_positions = self.total_positions - 1;
        } else {
            // Partial withdraw
            let updated: Position = Position{
                deposit_amount: remaining,
                leverage_bps: pos!!.leverage_bps,
                entry_twap: pos!!.entry_twap,
                last_fee_timestamp: now(),
                is_active: true
            };
            self.positions.set(sender, updated);
        }

        // Update exposure
        let exposure_delta: Int = (msg.amount * pos!!.leverage_bps) / 10000;
        self.net_exposure = self.net_exposure - exposure_delta;
        self.total_senior_deposits = self.total_senior_deposits - msg.amount;

        // Send USDC back (in production, this triggers a Jetton transfer)
        send(SendParameters{
            to: sender,
            value: 0,
            mode: SendRemainingValue,
            body: WithdrawNotification{
                amount: msg.amount,
                recipient: sender,
                query_id: msg.query_id
            }.toCell()
        });
    }

    receive(msg: AdjustLeverage) {
        require(self.protocol_state == STATE_ACTIVE, "Vault is not active");
        require(msg.new_leverage_bps >= MIN_LEVERAGE_BPS && msg.new_leverage_bps <= MAX_LEVERAGE_BPS, "Leverage out of range");

        let sender: Address = sender();
        let pos: Position? = self.positions.get(sender);
        require(pos != null, "No position found");
        require(pos!!.is_active, "Position is not active");

        let old_leverage: Int = pos!!.leverage_bps;

        // Calculate fee on the difference
        let fee: Int = self._calculateAdjustFee(pos!!.deposit_amount, old_leverage, msg.new_leverage_bps);

        // Check junior liquidity for increased leverage
        let new_abs: Int = self._abs(msg.new_leverage_bps);
        if (new_abs > 10000) {
            let new_borrowed: Int = (pos!!.deposit_amount * (new_abs - 10000)) / 10000;
            let old_abs: Int = self._abs(old_leverage);
            let old_borrowed: Int = if (old_abs > 10000) { (pos!!.deposit_amount * (old_abs - 10000)) / 10000 } else { 0 };
            if (new_borrowed > old_borrowed) {
                require((new_borrowed - old_borrowed) <= self.total_junior_deposits, "Insufficient junior liquidity");
            }
        }

        // Deduct fee from deposit
        let new_deposit: Int = pos!!.deposit_amount - fee;
        require(new_deposit > 0, "Fee exceeds remaining deposit");

        // Update position
        let updated: Position = Position{
            deposit_amount: new_deposit,
            leverage_bps: msg.new_leverage_bps,
            entry_twap: pos!!.entry_twap,
            last_fee_timestamp: now(),
            is_active: true
        };
        self.positions.set(sender, updated);

        // Update exposure
        let old_exposure: Int = (pos!!.deposit_amount * old_leverage) / 10000;
        let new_exposure: Int = (new_deposit * msg.new_leverage_bps) / 10000;
        self.net_exposure = self.net_exposure - old_exposure + new_exposure;
        self.total_senior_deposits = self.total_senior_deposits - fee;

        // Fee distribution
        self.insurance_fund = self.insurance_fund + (fee / 2);
        self.total_junior_deposits = self.total_junior_deposits + (fee - fee / 2);
    }

    // ═══════════════════════════════════════════════════════════
    // JUNIOR (LP) DEPOSITS
    // ═══════════════════════════════════════════════════════════

    receive(msg: DepositJunior) {
        require(self.protocol_state == STATE_ACTIVE, "Vault is not active");
        require(msg.amount > 0, "Deposit amount must be positive");
        require(context().value >= MIN_GAS_DEPOSIT, "Insufficient gas");

        let sender: Address = sender();

        // Calculate shares: 1:1 if first depositor, otherwise proportional
        let shares: Int = if (self.total_junior_shares == 0) {
            msg.amount
        } else {
            (msg.amount * self.total_junior_shares) / self.total_junior_deposits
        };
        require(shares > 0, "Share calculation underflow");

        // Update shares
        let existing_shares: Int? = self.junior_shares.get(sender);
        let prev: Int = if (existing_shares != null) { existing_shares!! } else { 0 };
        self.junior_shares.set(sender, prev + shares);

        self.total_junior_shares = self.total_junior_shares + shares;
        self.total_junior_deposits = self.total_junior_deposits + msg.amount;
    }

    receive(msg: WithdrawJunior) {
        require(self.protocol_state != STATE_PAUSED, "Vault is paused");
        require(msg.shares > 0, "Shares must be positive");

        let sender: Address = sender();
        let user_shares: Int? = self.junior_shares.get(sender);
        require(user_shares != null, "No junior position found");
        require(msg.shares <= user_shares!!, "Insufficient shares");

        // Calculate USDC amount for shares
        let amount: Int = (msg.shares * self.total_junior_deposits) / self.total_junior_shares;
        require(amount > 0, "Withdraw amount is zero");

        // Update shares
        self.junior_shares.set(sender, user_shares!! - msg.shares);
        self.total_junior_shares = self.total_junior_shares - msg.shares;
        self.total_junior_deposits = self.total_junior_deposits - amount;

        // Send USDC back
        send(SendParameters{
            to: sender,
            value: 0,
            mode: SendRemainingValue,
            body: WithdrawNotification{
                amount: amount,
                recipient: sender,
                query_id: msg.query_id
            }.toCell()
        });
    }

    // ═══════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════

    receive(msg: UpdatePythFeed) {
        require(sender() == self.owner, "Only owner");
        self.pyth_feed_id = msg.new_feed_id;
    }

    receive(msg: SetProtocolState) {
        require(sender() == self.owner, "Only owner");
        require(msg.new_state <= STATE_EMERGENCY, "Invalid state");
        self.protocol_state = msg.new_state;
    }

    receive(msg: WithdrawInsurance) {
        require(sender() == self.owner, "Only owner");
        require(msg.amount <= self.insurance_fund, "Exceeds insurance fund");

        self.insurance_fund = self.insurance_fund - msg.amount;

        send(SendParameters{
            to: msg.recipient,
            value: 0,
            mode: SendRemainingValue,
            body: WithdrawNotification{
                amount: msg.amount,
                recipient: msg.recipient,
                query_id: 0
            }.toCell()
        });
    }

    // ═══════════════════════════════════════════════════════════
    // BOUNCED MESSAGE HANDLING
    // ═══════════════════════════════════════════════════════════

    bounced(src: bounced<WithdrawNotification>) {
        // If a withdrawal notification bounces, credit back the amount
        // This is a safety mechanism — in production, Jetton transfer
        // bounces would be handled here to restore user balances.
        self.total_senior_deposits = self.total_senior_deposits + src.amount;
    }

    // ═══════════════════════════════════════════════════════════
    // GETTERS
    // ═══════════════════════════════════════════════════════════

    get fun vaultInfo(): VaultInfo {
        return VaultInfo{
            asset_symbol: self.asset_symbol,
            pyth_feed_id: self.pyth_feed_id,
            total_senior_deposits: self.total_senior_deposits,
            total_junior_deposits: self.total_junior_deposits,
            insurance_fund: self.insurance_fund,
            net_exposure: self.net_exposure,
            protocol_state: self.protocol_state
        };
    }

    get fun getPosition(user: Address): Position? {
        return self.positions.get(user);
    }

    get fun getJuniorShares(user: Address): Int {
        let s: Int? = self.junior_shares.get(user);
        if (s != null) {
            return s!!;
        }
        return 0;
    }

    get fun totalJuniorShares(): Int {
        return self.total_junior_shares;
    }

    get fun owner(): Address {
        return self.owner;
    }

    get fun vaultId(): Int {
        return self.vault_id;
    }

    get fun protocolState(): Int {
        return self.protocol_state;
    }

    get fun totalPositions(): Int {
        return self.total_positions;
    }

    get fun totalDepositedEver(): Int {
        return self.total_deposited_ever;
    }

    get fun calculateFeeView(amount: Int, leverage_bps: Int): Int {
        return self._calculateFee(amount, leverage_bps);
    }

    // ═══════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════

    fun _calculateFee(amount: Int, leverage_bps: Int): Int {
        let abs_lev: Int = self._abs(leverage_bps);

        // 0x or 1x => no fee
        if (abs_lev <= 10000) {
            return 0;
        }

        // units above 1x (in bps, so 20000 = 2x => 1 unit above)
        let units_above: Int = (abs_lev - 10000);

        // fee = amount * (BASE_FEE_BPS + PER_UNIT_FEE_BPS * units_above / 10000) / 10000
        let fee_bps: Int = BASE_FEE_BPS + (PER_UNIT_FEE_BPS * units_above) / 10000;
        return (amount * fee_bps) / 10000;
    }

    fun _calculateAdjustFee(amount: Int, old_leverage_bps: Int, new_leverage_bps: Int): Int {
        let old_abs: Int = self._abs(old_leverage_bps);
        let new_abs: Int = self._abs(new_leverage_bps);

        // Only charge fee if increasing leverage
        if (new_abs <= old_abs) {
            return 0;
        }

        let delta_units: Int = (new_abs - old_abs);
        let fee_bps: Int = (PER_UNIT_FEE_BPS * delta_units) / 10000;
        return (amount * fee_bps) / 10000;
    }

    fun _abs(x: Int): Int {
        if (x < 0) {
            return -x;
        }
        return x;
    }
}
