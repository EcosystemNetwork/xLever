// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @title FixedPriceOracle
/// @notice Simple oracle that returns fixed prices for testing/testnet
contract FixedPriceOracle is IPriceOracle {
    string public constant override name = "FixedPriceOracle";
    
    mapping(address => mapping(address => uint256)) public prices;
    address public owner;
    
    event PriceSet(address indexed base, address indexed quote, uint256 price);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    /// @notice Set a fixed price for a base/quote pair
    /// @param base The token being priced
    /// @param quote The unit of account
    /// @param price The price (in quote decimals per base token)
    function setPrice(address base, address quote, uint256 price) external onlyOwner {
        prices[base][quote] = price;
        emit PriceSet(base, quote, price);
    }
    
    /// @notice Get quote for converting base to quote
    function getQuote(uint256 inAmount, address base, address quote) 
        external 
        view 
        override 
        returns (uint256 outAmount) 
    {
        uint256 price = prices[base][quote];
        require(price > 0, "Price not set");
        
        // Price is in quote per base, so multiply inAmount by price
        outAmount = (inAmount * price) / 1e18;
    }
    
    /// @notice Get two-sided quotes (same for fixed price oracle)
    function getQuotes(uint256 inAmount, address base, address quote)
        external
        view
        override
        returns (uint256 bidOutAmount, uint256 askOutAmount)
    {
        uint256 price = prices[base][quote];
        require(price > 0, "Price not set");
        
        uint256 outAmount = (inAmount * price) / 1e18;
        bidOutAmount = outAmount;
        askOutAmount = outAmount;
    }
}
