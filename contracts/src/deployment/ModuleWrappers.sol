// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {Base} from "../EVault/shared/Base.sol";
import {Initialize} from "../EVault/modules/Initialize.sol";
import {Token} from "../EVault/modules/Token.sol";
import {Vault} from "../EVault/modules/Vault.sol";
import {Borrowing} from "../EVault/modules/Borrowing.sol";
import {Liquidation} from "../EVault/modules/Liquidation.sol";
import {RiskManager} from "../EVault/modules/RiskManager.sol";
import {BalanceForwarder} from "../EVault/modules/BalanceForwarder.sol";
import {Governance} from "../EVault/modules/Governance.sol";

// Concrete module contracts for deployment
contract InitializeModule is Initialize {
    constructor(Base.Integrations memory integrations) Initialize(integrations) {}
}

contract TokenModule is Token {
    constructor(Base.Integrations memory integrations) Token(integrations) {}
}

contract VaultModule is Vault {
    constructor(Base.Integrations memory integrations) Vault(integrations) {}
}

contract BorrowingModule is Borrowing {
    constructor(Base.Integrations memory integrations) Borrowing(integrations) {}
}

contract LiquidationModule is Liquidation {
    constructor(Base.Integrations memory integrations) Liquidation(integrations) {}
}

contract RiskManagerModule is RiskManager {
    constructor(Base.Integrations memory integrations) RiskManager(integrations) {}
}

contract BalanceForwarderModule is BalanceForwarder {
    constructor(Base.Integrations memory integrations) BalanceForwarder(integrations) {}
}

contract GovernanceModule is Governance {
    constructor(Base.Integrations memory integrations) Governance(integrations) {}
}
