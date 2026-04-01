"""Data loading utilities for backtesting."""

from datetime import datetime
from typing import Optional
import pandas as pd
from loguru import logger


class DataLoader:
    """Utility class for loading market data for backtesting."""

    @staticmethod
    def load_yahoo_finance(
        symbol: str,
        start: datetime,
        end: datetime,
        interval: str = "1h",
    ) -> pd.DataFrame:
        """Load historical OHLCV data from Yahoo Finance.

        Args:
            symbol: Trading symbol (e.g., 'ETH-USD', 'BTC-USD')
            start: Start date
            end: End date
            interval: Data interval (1m, 5m, 15m, 1h, 1d, etc.)

        Returns:
            DataFrame with OHLCV data indexed by timestamp

        Raises:
            ImportError: If yfinance is not installed
            ValueError: If no data returned
        """
        try:
            import yfinance as yf
        except ImportError:
            raise ImportError(
                "yfinance is required for Yahoo Finance data. "
                "Install with: pip install yfinance"
            )

        logger.info(f"Loading {symbol} data from Yahoo Finance: {start} to {end}")

        ticker = yf.Ticker(symbol)
        data = ticker.history(
            start=start,
            end=end,
            interval=interval,
        )

        if data.empty:
            raise ValueError(f"No data returned for {symbol} from {start} to {end}")

        # Standardize column names
        data.columns = [col.lower() for col in data.columns]

        # Ensure required columns exist
        required_cols = ["open", "high", "low", "close", "volume"]
        missing_cols = [col for col in required_cols if col not in data.columns]
        if missing_cols:
            raise ValueError(f"Missing required columns: {missing_cols}")

        # Remove timezone info if present for consistency
        if data.index.tz is not None:
            data.index = data.index.tz_localize(None)

        logger.info(f"Loaded {len(data)} bars of {symbol} data")

        return data[required_cols]

    @staticmethod
    def load_local_csv(
        path: str,
        date_column: str = "timestamp",
        date_format: Optional[str] = None,
    ) -> pd.DataFrame:
        """Load historical OHLCV data from local CSV file.

        Expected CSV format:
        - Must have columns: open, high, low, close, volume
        - Must have a timestamp/date column

        Args:
            path: Path to CSV file
            date_column: Name of the date/timestamp column
            date_format: Optional datetime format string (e.g., '%Y-%m-%d %H:%M:%S')

        Returns:
            DataFrame with OHLCV data indexed by timestamp

        Raises:
            FileNotFoundError: If CSV file not found
            ValueError: If required columns missing
        """
        logger.info(f"Loading data from CSV: {path}")

        try:
            # Parse dates automatically or with specified format
            if date_format:
                data = pd.read_csv(
                    path,
                    parse_dates=[date_column],
                    date_format=date_format,
                )
            else:
                data = pd.read_csv(path, parse_dates=[date_column])

            # Set timestamp as index
            data.set_index(date_column, inplace=True)

        except FileNotFoundError:
            raise FileNotFoundError(f"CSV file not found: {path}")
        except Exception as e:
            raise ValueError(f"Error reading CSV: {e}")

        # Standardize column names
        data.columns = [col.lower().strip() for col in data.columns]

        # Ensure required columns exist
        required_cols = ["open", "high", "low", "close", "volume"]
        missing_cols = [col for col in required_cols if col not in data.columns]
        if missing_cols:
            raise ValueError(f"Missing required columns in CSV: {missing_cols}")

        # Remove timezone info if present for consistency
        if data.index.tz is not None:
            data.index = data.index.tz_localize(None)

        logger.info(f"Loaded {len(data)} bars from CSV")

        return data[required_cols]

    @staticmethod
    def validate_ohlcv_data(data: pd.DataFrame) -> bool:
        """Validate that DataFrame contains valid OHLCV data.

        Args:
            data: DataFrame to validate

        Returns:
            True if valid, False otherwise
        """
        required_cols = ["open", "high", "low", "close", "volume"]

        # Check required columns
        if not all(col in data.columns for col in required_cols):
            logger.error(f"Missing required columns. Expected: {required_cols}")
            return False

        # Check for NaN values
        if data[required_cols].isnull().any().any():
            logger.warning("Data contains NaN values")
            return False

        # Check OHLC relationships (high >= low, high >= open/close, etc.)
        invalid_rows = (
            (data["high"] < data["low"]) |
            (data["high"] < data["open"]) |
            (data["high"] < data["close"]) |
            (data["low"] > data["open"]) |
            (data["low"] > data["close"])
        )

        if invalid_rows.any():
            logger.warning(f"Found {invalid_rows.sum()} rows with invalid OHLC relationships")
            return False

        # Check for negative values
        if (data[required_cols] < 0).any().any():
            logger.error("Data contains negative values")
            return False

        logger.info("Data validation passed")
        return True

    @staticmethod
    def resample_data(
        data: pd.DataFrame,
        timeframe: str,
    ) -> pd.DataFrame:
        """Resample OHLCV data to a different timeframe.

        Args:
            data: OHLCV DataFrame
            timeframe: Target timeframe (e.g., '1h', '4h', '1d')

        Returns:
            Resampled DataFrame
        """
        logger.info(f"Resampling data to {timeframe}")

        resampled = pd.DataFrame()
        resampled["open"] = data["open"].resample(timeframe).first()
        resampled["high"] = data["high"].resample(timeframe).max()
        resampled["low"] = data["low"].resample(timeframe).min()
        resampled["close"] = data["close"].resample(timeframe).last()
        resampled["volume"] = data["volume"].resample(timeframe).sum()

        # Drop any rows with NaN (incomplete periods)
        resampled.dropna(inplace=True)

        logger.info(f"Resampled to {len(resampled)} bars")

        return resampled
