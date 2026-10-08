"""Request/response schemas — mirror docs/API.md §1 exactly.

`weather_series` is an additive optional field (P4-5): per-day rain and
temperature over the history window so the model can use per-day weather
features in its training context, not just a snapshot. The v1 request
examples in API.md stay valid without it.
"""

from datetime import date

from pydantic import BaseModel, Field


class HistoryPoint(BaseModel):
    date: date
    discharge: float = Field(ge=0)


class WeatherSnapshot(BaseModel):
    """Contract §1.1 field: recent aggregates at prediction time."""

    rain_3d: float
    rain_7d: float
    rain_14d: float
    temp_mean_7d: float


class WeatherPoint(BaseModel):
    """Additive (P4-5): one day of archive weather."""

    date: date
    rain_mm: float = Field(ge=0)
    temp_mean_c: float


class PredictRequest(BaseModel):
    river_id: str
    history: list[HistoryPoint] = Field(min_length=60)
    weather: WeatherSnapshot | None = None
    weather_series: list[WeatherPoint] | None = None
    start_date: date


class HiddenWindow(BaseModel):
    from_: date = Field(alias="from")
    to: date

    model_config = {"populate_by_name": True}


class TruthPoint(BaseModel):
    date: date
    discharge: float = Field(ge=0)


class BacktestRequest(BaseModel):
    river_id: str
    history: list[HistoryPoint] = Field(min_length=60)
    hidden_window: HiddenWindow
    truth: list[TruthPoint] = Field(min_length=1)
    weather_series: list[WeatherPoint] | None = None


class BandDay(BaseModel):
    date: date
    band_lo: float
    band_high: float


class PredictDay(BandDay):
    pass


class BacktestDay(BandDay):
    actual: float
    covered: bool


class Metrics(BaseModel):
    mae: float
    band_coverage: float
    days: int


class PredictResponse(BaseModel):
    river_id: str
    model_version: str
    days: list[PredictDay]
    trained_through: date


class BacktestResponse(BaseModel):
    river_id: str
    model_version: str
    days: list[BacktestDay]
    metrics: Metrics
    trained_through: date


class HealthResponse(BaseModel):
    status: str
    model_version: str
    loaded: bool
